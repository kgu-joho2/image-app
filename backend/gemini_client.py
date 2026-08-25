"""
Gemini API 共通クライアント・ユーティリティ

- google.genai (新SDK) のみを使用する
- Interactions API (client.interactions.create) は SDK が未対応の場合 REST にフォールバック
- 各 Blueprint 共通のプロンプト整形・エラー応答をここに集約
"""
import os
import json
import base64
import traceback
import urllib.request
import urllib.error
from typing import Optional

from dotenv import load_dotenv
from flask import jsonify
from google import genai
from google.genai import types as genai_types

load_dotenv()

API_KEY = os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    raise ValueError("GOOGLE_API_KEY environment variable not set.")

client = genai.Client(api_key=API_KEY)

# プロンプト整形（日本語→英語）に使う汎用テキストモデル（先頭から順に試す）
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.6-flash")
TEXT_MODEL_FALLBACKS = [TEXT_MODEL, "gemini-2.5-flash", "gemini-3.5-flash-lite"]

INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"


# ---------------------------------------------------------------------------
# プロンプト整形
# ---------------------------------------------------------------------------
def generate_text(contents) -> str:
    """
    汎用テキスト生成。モデルが 404 の場合は TEXT_MODEL_FALLBACKS を順に試す。
    失敗時は例外を投げる。
    """
    last_err = None
    for model in TEXT_MODEL_FALLBACKS:
        try:
            resp = client.models.generate_content(model=model, contents=contents)
            return (getattr(resp, "text", None) or "").strip()
        except Exception as e:  # 404/未対応モデルのみ次へ
            last_err = e
            s = str(e)
            if "404" in s or "not found" in s.lower() or "no longer available" in s.lower():
                print(f"generate_text: {model} unavailable, trying next ({s[:80]})")
                continue
            raise
    raise last_err or RuntimeError("no text model available")


def enhance_prompt(instruction: str, user_text: str, fallback: Optional[str] = None) -> str:
    """
    instruction に従って user_text を整形した文字列を返す。
    失敗時は fallback（未指定なら user_text）を返し、例外は投げない。
    """
    if not user_text:
        return fallback if fallback is not None else user_text
    try:
        text = generate_text(f"{instruction}\n\nUser request: {user_text}")
        if text:
            return text
        print("enhance_prompt: empty response, using original text")
    except Exception as e:
        print(f"enhance_prompt skipped: {e}")
    return fallback if fallback is not None else user_text


# ---------------------------------------------------------------------------
# Interactions API（画像・TTS・音楽で共通）
# ---------------------------------------------------------------------------
def _interactions_rest(payload: dict) -> dict:
    req = urllib.request.Request(
        INTERACTIONS_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as he:
        detail = he.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {he.code}: {detail}")


def interactions_create(model: str, input_payload, **kwargs) -> dict:
    """
    client.interactions.create を呼び、結果を正規化した dict で返す:
      {
        "id": str | None,
        "text": str,                       # 連結したテキスト出力
        "images": [{"data": b64, "mime_type": str}],
        "audios": [{"data": b64, "mime_type": str}],
        "raw": dict,
      }
    kwargs: response_format, previous_interaction_id, tools, generation_config など
    """
    kwargs = {k: v for k, v in kwargs.items() if v is not None}
    interactions_api = getattr(client, "interactions", None)
    raw = None
    interaction = None

    if interactions_api is not None:
        interaction = interactions_api.create(model=model, input=input_payload, **kwargs)
        if hasattr(interaction, "model_dump"):
            try:
                raw = interaction.model_dump()
            except Exception:
                raw = None
    else:
        print("google-genai SDK に interactions が無いため REST で呼び出します")
        raw = _interactions_rest({"model": model, "input": input_payload, **kwargs})

    result = {"id": None, "text": "", "images": [], "audios": [], "raw": raw or {}}

    # SDK オブジェクトの便利プロパティを優先
    if interaction is not None:
        result["id"] = getattr(interaction, "id", None)
        result["text"] = (getattr(interaction, "output_text", None) or "").strip()
        for attr, bucket in (("output_image", "images"), ("output_audio", "audios")):
            obj = getattr(interaction, attr, None)
            if obj is not None and getattr(obj, "data", None):
                data = obj.data
                if isinstance(data, (bytes, bytearray)):
                    data = base64.b64encode(data).decode("utf-8")
                result[bucket].append({"data": data, "mime_type": getattr(obj, "mime_type", None)})

    # dict を走査して補完（複数画像や REST 応答に対応）
    if raw:
        found = _scan_outputs(raw)
        if not result["id"]:
            result["id"] = raw.get("id")
        if not result["text"]:
            result["text"] = found["text"]
        if not result["images"]:
            result["images"] = found["images"]
        if not result["audios"]:
            result["audios"] = found["audios"]
    return result


def _scan_outputs(obj: dict) -> dict:
    found = {"text": "", "images": [], "audios": []}

    def scan(items):
        for item in items or []:
            if not isinstance(item, dict):
                continue
            t = item.get("type")
            data = item.get("data")
            if isinstance(data, (bytes, bytearray)):
                data = base64.b64encode(data).decode("utf-8")
            mime = item.get("mime_type") or item.get("mimeType")
            if t == "image" and data:
                found["images"].append({"data": data, "mime_type": mime})
            elif t == "audio" and data:
                found["audios"].append({"data": data, "mime_type": mime})
            elif t == "text" and item.get("text"):
                found["text"] += item["text"]
            for key in ("content", "outputs", "steps"):
                if isinstance(item.get(key), list):
                    scan(item[key])

    for key in ("outputs", "steps", "content"):
        if isinstance(obj.get(key), list):
            scan(obj[key])
    found["text"] = found["text"].strip()
    return found


def to_data_url(b64: str, mime_type: str) -> str:
    return f"data:{mime_type};base64,{b64}"


# ---------------------------------------------------------------------------
# エラー応答
# ---------------------------------------------------------------------------
def api_error_response(e: Exception, label: str):
    """
    例外を利用者向けの JSON 応答へ変換する。label は「画像生成」など機能名。
    """
    print(f"{label} error: {e}")
    traceback.print_exc()
    s = str(e)
    low = s.lower()
    if "429" in s and ("resource_exhausted" in low or "quota" in low):
        return jsonify({
            "error": f"{label}の1日あたりの利用上限に達しました。明日再度お試しください。",
            "error_type": "quota_exceeded",
        }), 429
    if "quota" in low or "exceeded" in low or "429" in s:
        return jsonify({
            "error": f"{label}の利用上限に達しました。しばらく時間をおいてから再度お試しください。",
            "error_type": "quota_exceeded",
        }), 429
    if "404" in s or "not found" in low or "not_found" in low:
        return jsonify({
            "error": f"{label}モデルが利用できません（このAPIキーで未対応、またはモデル名が変更された可能性があります）。backend/check_models.py で確認してください。",
            "error_type": "model_unavailable",
        }), 500
    if "safety" in low or "blocked" in low or "prohibited" in low or "recitation" in low:
        reason = ""
        if "copyright" in low or "recitation" in low:
            reason = "（著作物・実在のロゴや旗などの再現とみなされた可能性があります）"
        return jsonify({
            "error": f"リクエストがフィルタでブロックされました{reason}。プロンプトの内容を見直してください。",
            "error_type": "blocked",
            "detail": s[:300],
        }), 400
    if "400" in s or "invalid_argument" in low:
        return jsonify({"error": f"リクエストが不正です: {s}", "error_type": "bad_request"}), 400
    return jsonify({"error": f"{label}中にエラーが発生しました: {s}"}), 500


def decode_image_input(img: dict):
    """{mime_type, data(b64)} → (mime_type, bytes) / 不正なら None"""
    try:
        mime_type = (img.get("mime_type") or "").lower()
        b64 = img.get("data")
        if not mime_type or not b64:
            return None
        return mime_type, base64.b64decode(b64)
    except Exception as e:
        print(f"decode_image_input failed: {e}")
        return None


__all__ = [
    "client", "genai_types", "API_KEY", "TEXT_MODEL", "generate_text",
    "enhance_prompt", "interactions_create", "to_data_url",
    "api_error_response", "decode_image_input",
]
