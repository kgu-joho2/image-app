"""
Text-to-Speech (Gemini TTS)
https://ai.google.dev/gemini-api/docs/speech-generation
"""
from flask import Blueprint, request, jsonify

from gemini_client import api_error_response

bp = Blueprint("tts", __name__)

tts_service = None
try:
    from tts_service import TTSService, TTS_MODELS, VOICES, STYLE_TAGS
    tts_service = TTSService()
    print("TTS service initialized successfully")
except Exception as e:  # pragma: no cover
    TTS_MODELS, VOICES, STYLE_TAGS = {}, [], []
    print(f"Warning: TTS service initialization failed: {e}")


def _unavailable():
    return jsonify({"success": False, "error": "TTS機能が利用できません。システム管理者にお問い合わせください。"}), 503


@bp.route("/api/tts/options")
def tts_options():
    return jsonify({
        "models": [{"key": k, **v} for k, v in TTS_MODELS.items()],
        "voices": VOICES,
        "style_tags": STYLE_TAGS,
    })


@bp.route("/api/tts/extract-text", methods=["POST"])
def extract_text():
    if not tts_service:
        return _unavailable()
    try:
        if "file" not in request.files or request.files["file"].filename == "":
            return jsonify({"success": False, "error": "ファイルが選択されていません"}), 400
        f = request.files["file"]
        return jsonify(tts_service.extract_text_from_file(f.read(), f.content_type, f.filename))
    except Exception as e:
        resp, code = api_error_response(e, "テキスト抽出")
        return jsonify({"success": False, **resp.get_json()}), code


@bp.route("/api/tts/summarize", methods=["POST"])
def summarize_text():
    if not tts_service:
        return _unavailable()
    try:
        data = request.get_json() or {}
        text = data.get("text")
        if not text:
            return jsonify({"success": False, "error": "要約するテキストが指定されていません"}), 400
        return jsonify(tts_service.summarize_text(text, data.get("speaker_mode", "single"), data.get("speaker_names")))
    except Exception as e:
        resp, code = api_error_response(e, "要約")
        return jsonify({"success": False, **resp.get_json()}), code


@bp.route("/api/tts/preview-voice", methods=["POST"])
def preview_voice():
    if not tts_service:
        return _unavailable()
    try:
        data = request.get_json() or {}
        result = tts_service.preview_voice(
            data.get("voice", "Kore"),
            data.get("text", "こんにちは。これは音声のプレビューです。"),
            data.get("style", ""),
            data.get("model"),
        )
        if result.get("success"):
            return jsonify({"success": True, "audio_data": result["audio_data"], "format": result["format"]})
        return jsonify({"success": False, "error": result.get("error", "音声プレビューに失敗しました")}), 500
    except Exception as e:
        resp, code = api_error_response(e, "音声プレビュー")
        return jsonify({"success": False, **resp.get_json()}), code


@bp.route("/api/tts/generate", methods=["POST"])
def generate_speech():
    if not tts_service:
        return _unavailable()
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        if not text:
            return jsonify({"success": False, "error": "テキストが指定されていません"}), 400
        result = tts_service.generate_speech(
            text,
            data.get("voice_settings", {}),
            data.get("speaker_mode", "single"),
            data.get("style", ""),
            data.get("rate", 1.0),
            data.get("model"),
        )
        if result.get("success"):
            return jsonify({"success": True, "audio_data": result["audio_data"], "format": result["format"],
                            "model": result.get("model")})
        return jsonify({"success": False, "error": result.get("error", "音声生成に失敗しました")}), 500
    except Exception as e:
        resp, code = api_error_response(e, "音声生成")
        return jsonify({"success": False, **resp.get_json()}), code
