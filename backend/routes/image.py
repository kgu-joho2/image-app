"""
画像生成 (Gemini Image / Nano Banana) — Interactions API
https://ai.google.dev/gemini-api/docs/image-generation
"""
from flask import Blueprint, request, jsonify

from gemini_client import (
    enhance_prompt, interactions_create, to_data_url, api_error_response,
)

bp = Blueprint("image", __name__)

IMAGE_MODELS = {
    "flash-lite": {"id": "gemini-3.1-flash-lite-image", "sizes": ["1K"], "search": False, "thinking": False},
    "flash":      {"id": "gemini-3.1-flash-image",      "sizes": ["512", "1K", "2K", "4K"], "search": True, "thinking": True},
    "pro":        {"id": "gemini-3-pro-image",          "sizes": ["1K", "2K", "4K"], "search": True, "thinking": True},
}
ASPECT_RATIOS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
MAX_INPUT_IMAGES = 14

ENHANCE_INSTRUCTION = (
    "You are a helpful assistant specializing in crafting effective prompts for AI image generation. "
    "Take the user's request (usually Japanese) and transform it into a detailed, descriptive English prompt "
    "suitable for an AI image generator. Focus on visual details, style, composition, lighting and mood. "
    "If the image must contain text, keep that text EXACTLY as the user wrote it (do not translate it). "
    "Default context: unless the user specifies a location or ethnicity, depict Japanese settings or people. "
    "Output ONLY the final prompt, without any explanation."
)
EDIT_INSTRUCTION = (
    "Translate the user's image-editing instruction (usually Japanese) into a concise, precise English instruction "
    "for an AI image editor. Preserve every detail the user asked to keep unchanged, and be explicit about what to change. "
    "If text must appear in the image, keep it exactly as written. Output ONLY the instruction."
)


@bp.route("/api/image/models")
def image_models():
    return jsonify({
        "models": [
            {"key": k, **v} for k, v in IMAGE_MODELS.items()
        ],
        "aspect_ratios": ASPECT_RATIOS,
        "max_input_images": MAX_INPUT_IMAGES,
    })


@bp.route("/api/image/generate", methods=["POST"])
def generate_image():
    try:
        data = request.get_json() or {}
        prompt = (data.get("prompt") or "").strip()
        images = data.get("images_data") or []
        options = data.get("options") or {}
        previous_id = data.get("previous_interaction_id") or None

        if not prompt and not images:
            return jsonify({"error": "プロンプトまたは画像を入力してください。"}), 400
        if not isinstance(images, list):
            images = []
        if len(images) > MAX_INPUT_IMAGES:
            return jsonify({"error": f"入力画像は最大{MAX_INPUT_IMAGES}枚までです。"}), 400

        model_cfg = IMAGE_MODELS.get(options.get("model", "flash"), IMAGE_MODELS["flash"])
        model = model_cfg["id"]

        # --- プロンプト整形 ---
        processed = prompt
        if prompt and options.get("enhance_prompt", True):
            is_edit = bool(images) or bool(previous_id)
            processed = enhance_prompt(EDIT_INSTRUCTION if is_edit else ENHANCE_INSTRUCTION, prompt)
        if not processed:
            processed = "Generate an image based on the attached image(s)."

        # --- 入力 ---
        if images:
            input_payload = [{"type": "text", "text": processed}]
            for img in images:
                mime = (img.get("mime_type") or "").lower()
                b64 = img.get("data")
                if mime and b64:
                    input_payload.append({"type": "image", "mime_type": mime, "data": b64})
        else:
            input_payload = processed

        # --- 出力形式 ---
        response_format = {"type": "image", "mime_type": "image/jpeg"}  # 現在 image/jpeg のみ対応
        ar = options.get("aspect_ratio")
        if ar in ASPECT_RATIOS:
            response_format["aspect_ratio"] = ar
        size = options.get("image_size")
        if size in model_cfg["sizes"]:
            response_format["image_size"] = size

        kwargs = {"response_format": response_format}
        if previous_id:
            kwargs["previous_interaction_id"] = previous_id
        if options.get("google_search") and model_cfg["search"]:
            kwargs["tools"] = [{"type": "google_search"}]
        thinking = options.get("thinking_level")
        if thinking in ("minimal", "high") and model_cfg["thinking"]:
            kwargs["generation_config"] = {"thinking_level": thinking}

        print(f"Image generation: model={model}, format={response_format}, prev={bool(previous_id)}, images={len(images)}")
        result = interactions_create(model, input_payload, **kwargs)

        results = []
        if result["text"]:
            results.append({"type": "text", "content": result["text"]})
        for im in result["images"]:
            mime = im.get("mime_type") or "image/jpeg"
            results.append({"type": "image", "content": to_data_url(im["data"], mime), "mime_type": mime})

        if not any(r["type"] == "image" for r in results):
            msg = result["text"] or "モデルから画像が返されませんでした。プロンプトを変えて再試行してください。"
            return jsonify({"error": msg, "results": results}), 500

        return jsonify({
            "results": results,
            "interaction_id": result["id"],
            "model": model,
            "prompt_used": processed,
        })
    except Exception as e:
        return api_error_response(e, "画像生成")
