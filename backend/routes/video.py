"""
動画生成 (Gemini Omni Flash / Interactions API) — ジョブID方式
https://ai.google.dev/gemini-api/docs/omni

Veo 3.1 Preview は 2026-10-22 に提供終了したため、後継の gemini-omni-1.1-flash を使う。
Interactions API の呼び出しは完了まで戻らないので、バックグラウンドスレッドで実行し、
フロントからはこれまで通りジョブIDでポーリングする。

POST /api/video/jobs        … 生成開始（即時に job_id を返す）
GET  /api/video/jobs/<id>   … 進捗確認。完了時に動画(data URL)を返す
"""
import re
import time
import uuid
import base64
import threading

from flask import Blueprint, request, jsonify

from gemini_client import client, enhance_prompt, error_payload, api_error_response

bp = Blueprint("video", __name__)

VIDEO_MODEL = "gemini-omni-1.1-flash"
DURATIONS = (3, 4, 6, 8, 10)          # API の許容範囲は 3〜10 秒
DEFAULT_DURATION = 4
RESOLUTIONS = ("360p", "720p", "1080p", "4k")
ASPECTS = ("16:9", "9:16")
MAX_REFERENCE_IMAGES = 3

# 料金（USD / 100万トークン）https://ai.google.dev/gemini-api/docs/pricing
# 720p は 1 秒あたり 5,792 出力トークン ≒ $0.10/秒（公式）
# 360p は 1 秒あたり 1,931 出力トークン ≒ $0.034/秒（2026-10-30 実測）
# 延長は「元動画＋続き」が1本で返り、課金は追加分の秒数のみ（実測）
PRICE_OUTPUT_PER_M = 17.50
PRICE_INPUT_PER_M = 1.50

# job_id -> {"status": str, "created": float, "result": dict|None, "error": str|None,
#            "model": str, "prompt_used": str, "interaction_id": str|None, "options": dict}
_jobs: dict = {}
_lock = threading.Lock()
JOB_TTL_SEC = 60 * 60 * 6  # 6時間で忘れる
FILE_READY_TIMEOUT_SEC = 120
CREATE_TIMEOUT_SEC = 900


def _gc_jobs():
    now = time.time()
    with _lock:
        for k in [k for k, v in _jobs.items() if now - v["created"] > JOB_TTL_SEC]:
            _jobs.pop(k, None)


def _build_instruction(has_image: bool, has_last: bool, is_extension: bool, has_refs: bool, has_negative: bool) -> str:
    base = (
        "You are a professional video prompt engineer. Rewrite the user's request (usually Japanese) into a detailed, "
        "production-ready English prompt for Gemini Omni video generation. Be explicit about subject(s), actions over time, "
        "camera movement (dolly-in, pan, drone shot...), framing, lighting, color mood, visual style, ambience and sound. "
        "Keep it concise but specific. Output ONLY the final prompt."
    )
    if is_extension:
        base += " IMPORTANT: This prompt continues an existing video; describe what happens NEXT while keeping continuity."
    elif has_image and has_last:
        base += " IMPORTANT: The video starts from the attached FIRST frame and ends on the attached LAST frame; describe the transition between them."
    elif has_image:
        base += " IMPORTANT: Use the attached image as the FIRST FRAME and preserve subject identity, colors and layout."
    if has_refs:
        base += " The attached reference images define the appearance of the subject(s); keep them consistent."
    if has_negative:
        base += " The request lists elements to avoid; end the prompt with one sentence starting with 'Do not show'."
    return base


def _image_part(img: dict):
    if not isinstance(img, dict) or not img.get("data") or not img.get("mime_type"):
        return None
    return {"type": "image", "data": img["data"], "mime_type": img["mime_type"].lower()}


def _estimate_cost(usage) -> dict:
    if usage is None:
        return {}
    u = usage.model_dump() if hasattr(usage, "model_dump") else dict(usage)
    out_tok = u.get("total_output_tokens") or 0
    in_tok = u.get("total_input_tokens") or 0
    usd = out_tok * PRICE_OUTPUT_PER_M / 1e6 + in_tok * PRICE_INPUT_PER_M / 1e6
    return {"input_tokens": in_tok, "output_tokens": out_tok, "cost_usd": round(usd, 4)}


def _file_name_from_uri(uri: str):
    m = re.search(r"(files/[\w\-]+)", uri or "")
    return m.group(1) if m else None


def _extract_video(interaction):
    """Interaction から (bytes, mime) を取り出す。URI 配信の場合はファイルの準備完了を待ってダウンロード。"""
    video = getattr(interaction, "output_video", None)
    if video is None:
        # 念のため steps を走査
        for step in getattr(interaction, "steps", None) or []:
            for c in getattr(step, "content", None) or []:
                if getattr(c, "type", None) == "video":
                    video = c
    if video is None:
        return None, None
    mime = getattr(video, "mime_type", None) or "video/mp4"
    data = getattr(video, "data", None)
    if data:
        return (bytes(data) if isinstance(data, (bytes, bytearray)) else base64.b64decode(data)), mime

    uri = getattr(video, "uri", None)
    if not uri:
        return None, mime
    name = _file_name_from_uri(uri)
    if name:
        deadline = time.time() + FILE_READY_TIMEOUT_SEC
        while True:
            f = client.files.get(name=name)
            state = str(getattr(f, "state", "") or "")
            if "ACTIVE" in state:
                break
            if "FAILED" in state:
                raise RuntimeError(f"生成動画ファイルの処理に失敗しました ({state})")
            if time.time() > deadline:
                raise RuntimeError("生成動画ファイルの準備がタイムアウトしました")
            time.sleep(2)
    return client.files.download(file=name or uri), mime


def _run_job(job_id: str, kwargs: dict):
    started = time.time()
    try:
        # SDK 既定はタイムアウト無し・リトライ無し（再送による二重課金は起きない）
        interaction = client.interactions.create(**kwargs, timeout=CREATE_TIMEOUT_SEC)
        video_bytes, mime = _extract_video(interaction)
        if not video_bytes:
            text = (getattr(interaction, "output_text", None) or "").strip()
            raise RuntimeError(f"動画が生成されませんでした。{text[:200]}".strip())
        b64 = base64.b64encode(video_bytes).decode("utf-8")
        usage = _estimate_cost(getattr(interaction, "usage", None))
        with _lock:
            job = _jobs[job_id]
            job["interaction_id"] = getattr(interaction, "id", None)
            job["result"] = {
                "results": [{"type": "video", "content": f"data:{mime};base64,{b64}", "mime_type": mime}],
                "model": job["model"],
                "prompt_used": job["prompt_used"],
                "options": job["options"],
                "usage": usage,
                "elapsed": int(time.time() - job["created"]),
            }
            job["status"] = "done"
        print(f"Video job {job_id[:8]} done in {time.time() - started:.0f}s, {len(video_bytes)//1024}KB, usage={usage}")
    except Exception as e:
        payload, _ = error_payload(e, "動画生成")
        with _lock:
            if job_id in _jobs:
                _jobs[job_id]["status"] = "error"
                _jobs[job_id]["error"] = payload.get("error")


@bp.route("/api/video/models")
def video_models():
    return jsonify({
        "models": [{"key": "omni", "id": VIDEO_MODEL}],
        "durations": DURATIONS,
        "default_duration": DEFAULT_DURATION,
        "resolutions": RESOLUTIONS,
        "aspect_ratios": ASPECTS,
        "max_reference_images": MAX_REFERENCE_IMAGES,
        "price_usd_per_sec_720p": round(5792 * PRICE_OUTPUT_PER_M / 1e6, 3),
    })


@bp.route("/api/video/jobs", methods=["POST"])
def create_job():
    _gc_jobs()
    try:
        data = request.get_json() or {}
        prompt = (data.get("prompt") or "").strip()
        options = data.get("options") or {}
        first_image = _image_part(data.get("first_frame"))
        last_image = _image_part(data.get("last_frame"))
        reference_images = [p for p in (_image_part(r) for r in (data.get("reference_images") or [])) if p]
        extend_job_id = data.get("extend_job_id")

        if not prompt:
            return jsonify({"error": "プロンプトを入力してください。"}), 400
        if len(reference_images) > MAX_REFERENCE_IMAGES:
            return jsonify({"error": f"参照画像は最大{MAX_REFERENCE_IMAGES}枚までです。"}), 400

        source = None
        if extend_job_id:
            with _lock:
                src = _jobs.get(extend_job_id)
            if not src or not src.get("interaction_id"):
                return jsonify({"error": "延長元の動画が見つかりません（有効期限切れの可能性があります）。"}), 400
            source = src

        try:
            duration = int(options.get("duration_seconds") or DEFAULT_DURATION)
        except Exception:
            duration = DEFAULT_DURATION
        if duration not in DURATIONS:
            duration = DEFAULT_DURATION
        resolution = options.get("resolution") if options.get("resolution") in RESOLUTIONS else "720p"
        aspect = options.get("aspect_ratio") if options.get("aspect_ratio") in ASPECTS else "16:9"
        negative = (options.get("negative_prompt") or "").strip()

        # Omni にはネガティブプロンプト欄が無いので、プロンプト内に「Do not show …」として含める
        processed = prompt
        if options.get("enhance_prompt", True):
            user_text = prompt + (f"\n\n避けたい要素: {negative}" if negative else "")
            processed = enhance_prompt(
                _build_instruction(bool(first_image), bool(last_image), bool(source),
                                   bool(reference_images), bool(negative)),
                user_text,
            )
        elif negative:
            processed = f"{prompt}\n\nDo not show: {negative}."

        response_format = {"type": "video", "duration": f"{duration}s", "resolution": resolution, "delivery": "uri"}
        kwargs = {"model": VIDEO_MODEL}
        task = None

        if source is not None:
            # 延長: 直前の生成結果を previous_interaction_id で引き継ぐ（縦横比・解像度は元動画に合わせる）
            kwargs["previous_interaction_id"] = source["interaction_id"]
            resolution = source["options"]["resolution"]
            aspect = source["options"]["aspect_ratio"]
            response_format["resolution"] = resolution
            # previous_interaction_id と video_config.task は併用できない（400）ため、指示文で延長を明示する
            kwargs["input"] = f"Extend this video. {processed}"
        else:
            response_format["aspect_ratio"] = aspect
            parts = []
            if first_image:
                parts.append(first_image)
                if last_image:
                    parts.append(last_image)
                else:
                    task = "image_to_video"
            elif reference_images:
                parts.extend(reference_images)
                task = "reference_to_video"
            kwargs["input"] = parts + [{"type": "text", "text": processed}] if parts else processed

        kwargs["response_format"] = response_format
        if task:
            kwargs["generation_config"] = {"video_config": {"task": task}}

        job_options = {"duration_seconds": duration, "resolution": resolution, "aspect_ratio": aspect}
        print(f"Video job: model={VIDEO_MODEL}, task={task or 'auto'}, {job_options}, "
              f"first={bool(first_image)}, last={bool(last_image)}, refs={len(reference_images)}, extend={source is not None}")

        job_id = uuid.uuid4().hex
        with _lock:
            _jobs[job_id] = {
                "status": "running", "created": time.time(), "result": None, "error": None,
                "model": VIDEO_MODEL, "prompt_used": processed, "interaction_id": None, "options": job_options,
            }
        threading.Thread(target=_run_job, args=(job_id, kwargs), daemon=True).start()
        return jsonify({"job_id": job_id, "status": "running", "prompt_used": processed, "model": VIDEO_MODEL}), 202
    except Exception as e:
        return api_error_response(e, "動画生成")


@bp.route("/api/video/jobs/<job_id>")
def get_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return jsonify({"error": "ジョブが見つかりません。"}), 404
        status, result, error, created = job["status"], job["result"], job["error"], job["created"]
    if status == "done":
        return jsonify({"job_id": job_id, "status": "done", **result})
    if status == "error":
        return jsonify({"job_id": job_id, "status": "error", "error": error}), 500
    return jsonify({"job_id": job_id, "status": "running", "elapsed": int(time.time() - created)})
