#!/usr/bin/env python3
"""
利用中の API キーで各生成モデルが使えるかを確認するスクリプト。

  docker compose exec image-app python backend/check_models.py
  （またはローカルで）cd backend && python check_models.py

--live を付けると実際に最小リクエストを送って疎通確認します（課金対象）。
"""
import sys
import argparse

from gemini_client import client, TEXT_MODEL

TARGETS = {
    "テキスト(整形用)": [TEXT_MODEL],
    "画像生成": ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"],
    "動画生成": ["veo-3.1-fast-generate-preview", "veo-3.1-generate-preview", "veo-3.1-lite-generate-preview"],
    "音声生成": ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"],
    "音楽生成": ["lyria-3-clip-preview", "lyria-3-pro-preview"],
}


def list_available():
    names = set()
    try:
        for m in client.models.list():
            n = getattr(m, "name", "") or ""
            names.add(n.replace("models/", ""))
    except Exception as e:
        print(f"models.list に失敗: {e}")
    return names


def live_check(model: str) -> str:
    try:
        if "image" in model and "gemini" in model:
            r = client.interactions.create(model=model, input="A tiny red dot on white background.",
                                           response_format={"type": "image", "image_size": "1K", "aspect_ratio": "1:1"})
            return "OK" if getattr(r, "output_image", None) else "応答に画像なし"
        if "tts" in model:
            from google.genai import types
            r = client.models.generate_content(
                model=model, contents="テスト",
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")))))
            return "OK" if r.candidates else "応答なし"
        if "lyria" in model:
            r = client.interactions.create(model=model, input="A short calm piano loop.")
            return "OK" if getattr(r, "output_audio", None) else "応答に音声なし"
        if "veo" in model:
            op = client.models.generate_videos(model=model, prompt="A leaf falling.")
            return f"OK (operation started: {getattr(op, 'name', '')})"
        r = client.models.generate_content(model=model, contents="ping")
        return "OK"
    except Exception as e:
        s = str(e)
        return "NG: " + (s[:160] + "…" if len(s) > 160 else s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="実際にリクエストを送って確認する（課金対象）")
    args = ap.parse_args()

    print("=== models.list による確認 ===")
    available = list_available()
    if not available:
        print("（一覧が取得できませんでした。--live で個別確認してください）")
    for cat, models in TARGETS.items():
        print(f"\n[{cat}]")
        for m in models:
            listed = "listed" if m in available else "not listed"
            line = f"  {m:<40} {listed}"
            if args.live:
                line += f"  live: {live_check(m)}"
            print(line)

    print("\nSDK interactions API:", "あり" if hasattr(client, "interactions") else "なし（RESTフォールバック使用）")


if __name__ == "__main__":
    sys.exit(main())
