"""
動画生成 (Veo 3.1) — ジョブID方式
https://ai.google.dev/gemini-api/docs/veo

POST /api/video/jobs        … 生成開始（即時に job_id を返す）
GET  /api/video/jobs/<id>   … 進捗確認。完了時に動画(data URL)を返す
"""
import uuid
import time
import base64
import threading

from flask import Blueprint, request, jsonify

from gemini_client import (
    client, genai_types, enhance_prompt, api_error_response, decode_image_input,
)

bp = Blueprint("video", __name__)

VIDEO_MODELS = {
    "fast":     "veo-3.1-fast-generate-preview",
    "standard": "veo-3.1-generate-preview",
    "lite":     "veo-3.1-lite-generate-preview",
}
DURATIONS = (4, 6, 8)
RESOLUTIONS = ("720p", "1080p", "4k")
ASPECTS = ("16:9", "9:16")
MAX_REFERENCE_IMAGES = 3

# job_id -> {"operation": ..., "status": str, "created": float, "video": types.Video|None,
#            "result": dict|None, "error": str|None, "model": str}
_jobs: dict = {}
_lock = threading.Lock()
JOB_TTL_SEC = 60 * 60 * 6  # 6時間で忘れる（サーバー側の動画自体は2日保持）


def _gc_jobs():
    now = time.time()
    with _lock:
        for k in [k for k, v in _jobs.items() if now - v["created"] > JOB_TTL_SEC]:
            _jobs.pop(k, None)


def _build_instruction(has_image: bool, has_last: bool, is_extension: bool, has_refs: bool) -> str:
    base = (
        "You are a professional video prompt engineer. Rewrite the user's request (usually Japanese) into a detailed, "
        "production-ready English prompt for Veo video generation. Be explicit about subject(s), actions over time, "
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
    return base


def _to_image(img: dict):
    dec = decode_image_input(img)
    if not dec:
        return None
    mime, raw = dec
    return genai_types.Image(image_bytes=raw, mime_type=mime)


@bp.route("/api/video/models")
def video_models():
    return jsonify({
        "models": [{"key": k, "id": v} for k, v in VIDEO_MODELS.items()],
        "durations": DURATIONS,
        "resolutions": RESOLUTIONS,
        "aspect_ratios": ASPECTS,
        "max_reference_images": MAX_REFERENCE_IMAGES,
    })


@bp.route("/api/video/jobs", methods=["POST"])
def create_job():
    _gc_jobs()
    try:
        data = request.get_json() or {}
        prompt = (data.get("prompt") or "").strip()
        options = data.get("options") or {}
        first_image = data.get("first_frame")          # {mime_type, data}
        last_image = data.get("last_frame")            # {mime_type, data}
        reference_images = data.get("reference_images") or []  # [{mime_type, data}]
        extend_job_id = data.get("extend_job_id")      # 延長元ジョブ

        if not prompt:
            return jsonify({"error": "プロンプトを入力してください。"}), 400
        if len(reference_images) > MAX_REFERENCE_IMAGES:
            return jsonify({"error": f"参照画像は最大{MAX_REFERENCE_IMAGES}枚までです。"}), 400

        model = VIDEO_MODELS.get(options.get("model", "fast"), VIDEO_MODELS["fast"])

        source_video = None
        if extend_job_id:
            with _lock:
                src = _jobs.get(extend_job_id)
            if not src or not src.get("video"):
                return jsonify({"error": "延長元の動画が見つかりません（有効期限切れの可能性があります）。"}), 400
            source_video = src["video"]

        processed = prompt
        if options.get("enhance_prompt", True):
            processed = enhance_prompt(
                _build_instruction(bool(first_image), bool(last_image), bool(source_video), bool(reference_images)),
                prompt,
            )

        cfg = {}
        try:
            d = int(options.get("duration_seconds") or 8)
            if d in DURATIONS:
                cfg["duration_seconds"] = d
        except Exception:
            pass
        if options.get("resolution") in RESOLUTIONS:
            cfg["resolution"] = options["resolution"]
        if options.get("aspect_ratio") in ASPECTS:
            cfg["aspect_ratio"] = options["aspect_ratio"]
        neg = (options.get("negative_prompt") or "").strip()
        if neg:
            cfg["negative_prompt"] = neg
        # generate_audio は Gemini Developer API では指定不可（常に音声付きで生成される）
        if options.get("person_generation") in ("allow_all", "allow_adult", "dont_allow"):
            cfg["person_generation"] = options["person_generation"]

        kwargs = {"model": model, "prompt": processed}

        if source_video is not None:
            kwargs["video"] = source_video
            # 延長は 720p のみ対応
            cfg["resolution"] = "720p"
            cfg.pop("aspect_ratio", None)
        else:
            if first_image:
                img = _to_image(first_image)
                if img:
                    kwargs["image"] = img
            if last_image and "image" in kwargs:
                last = _to_image(last_image)
                if last:
                    cfg["last_frame"] = last
            refs = []
            for r in reference_images:
                img = _to_image(r)
                if img:
                    refs.append(genai_types.VideoGenerationReferenceImage(image=img, reference_type="asset"))
            if refs:
                cfg["reference_images"] = refs

        if cfg:
            kwargs["config"] = genai_types.GenerateVideosConfig(**cfg)

        print(f"Video job: model={model}, cfg={ {k: v for k, v in cfg.items() if k not in ('last_frame','reference_images')} }, "
              f"image={'image' in kwargs}, last={'last_frame' in cfg}, refs={len(cfg.get('reference_images', []))}, extend={source_video is not None}")
        operation = client.models.generate_videos(**kwargs)

        job_id = uuid.uuid4().hex
        with _lock:
            _jobs[job_id] = {
                "operation": operation, "status": "running", "created": time.time(),
                "video": None, "result": None, "error": None, "model": model,
                "prompt_used": processed,
            }
        return jsonify({"job_id": job_id, "status": "running", "prompt_used": processed, "model": model}), 202
    except Exception as e:
        return api_error_response(e, "動画生成")


@bp.route("/api/video/jobs/<job_id>")
def get_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "ジョブが見つかりません。"}), 404
    if job["status"] == "done":
        return jsonify({"job_id": job_id, "status": "done", **job["result"]})
    if job["status"] == "error":
        return jsonify({"job_id": job_id, "status": "error", "error": job["error"]}), 500

    try:
        operation = client.operations.get(job["operation"])
        job["operation"] = operation
        if not getattr(operation, "done", False):
            elapsed = int(time.time() - job["created"])
            return jsonify({"job_id": job_id, "status": "running", "elapsed": elapsed})

        err = getattr(operation, "error", None)
        if err:
            raise RuntimeError(str(err))
        resp = getattr(operation, "response", None)
        videos = getattr(resp, "generated_videos", None) or []
        if not videos:
            # 安全性フィルタ等で0本になる場合
            reason = getattr(resp, "rai_media_filtered_reasons", None)
            raise RuntimeError(f"動画が生成されませんでした。{reason or ''}".strip())

        gv = videos[0]
        downloaded = client.files.download(file=gv.video)
        video_bytes = downloaded if isinstance(downloaded, (bytes, bytearray)) else None
        if not video_bytes:
            video_bytes = getattr(gv.video, "video_bytes", None)
        if not video_bytes:
            raise RuntimeError("動画データの取得に失敗しました")
        mime = getattr(gv.video, "mime_type", None) or "video/mp4"
        b64 = base64.b64encode(video_bytes).decode("utf-8")
        job["video"] = gv.video
        job["status"] = "done"
        job["result"] = {
            "results": [{"type": "video", "content": f"data:{mime};base64,{b64}", "mime_type": mime}],
            "model": job["model"],
            "prompt_used": job["prompt_used"],
            "elapsed": int(time.time() - job["created"]),
        }
        return jsonify({"job_id": job_id, "status": "done", **job["result"]})
    except Exception as e:
        job["status"] = "error"
        resp, code = api_error_response(e, "動画生成")
        job["error"] = resp.get_json().get("error")
        return resp, code
