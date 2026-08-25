"""
音楽生成 (Lyria 3) — Interactions API
https://ai.google.dev/gemini-api/docs/music-generation
"""
from flask import Blueprint, request, jsonify

from gemini_client import enhance_prompt, interactions_create, to_data_url, api_error_response

bp = Blueprint("music", __name__)

MUSIC_MODELS = {
    "clip": "lyria-3-clip-preview",  # 30秒クリップ (MP3)
    "pro":  "lyria-3-pro-preview",   # フル尺 (MP3 / WAV)
}
MAX_IMAGES = 10

ENHANCE_INSTRUCTION = (
    "You are a professional music prompt engineer for Google's Lyria 3 music model. "
    "Rewrite the user's request (usually Japanese) into a rich English prompt. "
    "Be explicit about genre, mood, instruments, tempo (BPM), key/scale, and structure. "
    "If the user wants vocals/lyrics, KEEP the lyrics in the user's original language and use "
    "section tags like [Intro], [Verse], [Chorus], [Bridge], [Outro]. "
    "If the user asks for an instrumental, say 'instrumental' explicitly. "
    "Preserve any duration, BPM, key or timestamp the user specified. "
    "Never reference real artists' names or voices. "
    "Output only the final prompt with no explanation."
)


@bp.route("/api/music/models")
def music_models():
    return jsonify({"models": [{"key": k, "id": v} for k, v in MUSIC_MODELS.items()], "max_images": MAX_IMAGES})


@bp.route("/api/music/generate", methods=["POST"])
def generate_music():
    try:
        data = request.get_json() or {}
        prompt = (data.get("prompt") or "").strip()
        images = data.get("images_data") or []
        options = data.get("options") or {}

        model_key = options.get("model", "clip")
        model = MUSIC_MODELS.get(model_key, MUSIC_MODELS["clip"])
        want_wav = bool(options.get("wav")) and model_key == "pro"

        if not prompt and not images:
            return jsonify({"error": "プロンプトまたは参照画像を入力してください。"}), 400
        if not isinstance(images, list):
            images = []
        if len(images) > MAX_IMAGES:
            return jsonify({"error": f"参照画像は最大{MAX_IMAGES}枚までです。"}), 400

        processed = prompt
        if prompt and options.get("enhance_prompt", True):
            instr = ENHANCE_INSTRUCTION
            if images:
                instr += " The request also includes reference image(s); mention that the music should reflect their mood and colors."
            processed = enhance_prompt(instr, prompt)
        if not processed:
            processed = "Music inspired by the mood and colors of the attached image(s)."

        if images:
            input_payload = [{"type": "text", "text": processed}]
            for img in images:
                mime = (img.get("mime_type") or "").lower()
                b64 = img.get("data")
                if mime and b64:
                    input_payload.append({"type": "image", "mime_type": mime, "data": b64})
        else:
            input_payload = processed

        print(f"Music generation: model={model}, wav={want_wav}, images={len(images)}")
        result = interactions_create(
            model, input_payload,
            response_format={"type": "audio"} if want_wav else None,
        )
        if not result["audios"]:
            return jsonify({"error": "モデルから音楽出力が得られませんでした。プロンプトを変えて再試行してください。"}), 500

        audio = result["audios"][0]
        mime = audio.get("mime_type") or ("audio/wav" if want_wav else "audio/mpeg")
        return jsonify({
            "results": [{"type": "audio", "content": to_data_url(audio["data"], mime), "mime_type": mime,
                         "lyrics": result["text"]}],
            "model": model,
            "prompt_used": processed,
        })
    except Exception as e:
        return api_error_response(e, "音楽生成")
