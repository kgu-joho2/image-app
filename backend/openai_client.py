"""
OpenAI 共通クライアント
- Images API（GPT Image 2.5）: https://developers.openai.com/api/docs/guides/image-generation
- Responses API（構造化出力）: スライドの演出プランニング用

- OPENAI_API_KEY 未設定でもアプリは起動する（呼び出し時にエラー）
- 画像結果は gemini_client.interactions_create と同じく [{"data": b64, "mime_type": str}] に正規化
"""
import os
import json
from typing import List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENAI_API_KEY")

# 演出プランを考える汎用モデル（先頭から順に試す）
PLANNER_MODEL = os.getenv("OPENAI_PLANNER_MODEL", "gpt-6-astra")
PLANNER_MODEL_FALLBACKS = list(dict.fromkeys([PLANNER_MODEL, "gpt-6-astra", "gpt-5.5"]))

# 幅・高さとも16の倍数、比率 1:3〜3:1、最大辺 3840、総画素 655,360〜8,294,400
SIZE_STEP = 16
MAX_EDGE = 3840
MIN_PIXELS = 655_360
MAX_PIXELS = 8_294_400

_client = None


def is_available() -> bool:
    return bool(API_KEY)


def get_client():
    global _client
    if not API_KEY:
        raise RuntimeError("OPENAI_API_KEY が設定されていません。backend/.env に追加してください。")
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(api_key=API_KEY, timeout=600)
    return _client


def fit_size(aspect: float, long_edge: int) -> str:
    """比率(幅/高さ)と長辺から、API 制約を満たす 'WxH' を返す"""
    aspect = min(3.0, max(1 / 3, float(aspect)))
    long_edge = min(MAX_EDGE, int(long_edge))
    if aspect >= 1:
        w, h = long_edge, long_edge / aspect
    else:
        w, h = long_edge * aspect, long_edge
    # 総画素数を範囲内へ
    px = w * h
    if px < MIN_PIXELS:
        s = (MIN_PIXELS / px) ** 0.5
        w, h = w * s, h * s
    elif px > MAX_PIXELS:
        s = (MAX_PIXELS / px) ** 0.5
        w, h = w * s, h * s

    def snap(v, up):
        n = int(v // SIZE_STEP) + (1 if up and v % SIZE_STEP else 0)
        return max(SIZE_STEP, n * SIZE_STEP)

    # 下限割れを避けるため不足時は切り上げ、超過時は切り下げ
    up = px < MIN_PIXELS
    w, h = min(MAX_EDGE, snap(w, up)), min(MAX_EDGE, snap(h, up))
    while w * h > MAX_PIXELS:
        w, h = w - SIZE_STEP, h - SIZE_STEP
    while w * h < MIN_PIXELS:
        w, h = w + SIZE_STEP, h + SIZE_STEP
    return f"{w}x{h}"


def _params(size, quality, background, output_format, output_compression, n) -> dict:
    p = {
        "size": size or "auto",
        "quality": quality or "auto",
        "background": background or "auto",
        "output_format": output_format or "png",
        "n": n or 1,
    }
    if p["background"] == "transparent" and p["output_format"] == "jpeg":
        p["output_format"] = "png"  # 透過は png / webp のみ
    if output_compression is not None and p["output_format"] in ("jpeg", "webp"):
        p["output_compression"] = int(output_compression)
    return p


def _normalize(resp, output_format: str) -> List[dict]:
    mime = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}.get(output_format, "image/png")
    return [{"data": d.b64_json, "mime_type": mime} for d in (resp.data or []) if getattr(d, "b64_json", None)]


def images_generate(model: str, prompt: str, size: Optional[str] = None, quality: Optional[str] = None,
                    background: Optional[str] = None, output_format: Optional[str] = None,
                    output_compression: Optional[int] = None, n: int = 1, moderation: Optional[str] = None) -> List[dict]:
    p = _params(size, quality, background, output_format, output_compression, n)
    resp = get_client().images.generate(model=model, prompt=prompt, moderation=moderation or "auto", **p)
    return _normalize(resp, p["output_format"])


def images_edit(model: str, prompt: str, images: List[Tuple[str, bytes, str]], size: Optional[str] = None,
                quality: Optional[str] = None, background: Optional[str] = None, output_format: Optional[str] = None,
                output_compression: Optional[int] = None, n: int = 1) -> List[dict]:
    """images: [(filename, bytes, mime_type)]（edit は moderation 非対応）"""
    p = _params(size, quality, background, output_format, output_compression, n)
    resp = get_client().images.edit(model=model, prompt=prompt, image=list(images), **p)
    return _normalize(resp, p["output_format"])


def responses_json(instructions: str, content: list, schema: dict, name: str) -> Tuple[dict, str]:
    """
    Responses API の構造化出力で JSON を得る。モデルが 404 の場合は PLANNER_MODEL_FALLBACKS を順に試す。
    content: Responses API の user content parts（input_text / input_image）
    戻り値: (dict, 使用モデル)
    """
    last_err = None
    for model in PLANNER_MODEL_FALLBACKS:
        try:
            resp = get_client().responses.create(
                model=model,
                instructions=instructions,
                input=[{"role": "user", "content": content}],
                text={"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}},
            )
            return json.loads(resp.output_text), model
        except Exception as e:
            last_err = e
            s = str(e)
            if "404" in s or "model_not_found" in s or "does not exist" in s:
                print(f"responses_json: {model} unavailable, trying next ({s[:80]})")
                continue
            raise
    raise last_err or RuntimeError("no planner model available")


__all__ = ["is_available", "get_client", "fit_size", "images_generate", "images_edit", "responses_json"]
