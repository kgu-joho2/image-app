"""
Gemini マルチメディア生成アプリ — Flask エントリポイント

  /            ランチャー（トップ）
  /image/      画像生成
  /video/      動画生成
  /tts/        音声生成
  /music/      音楽生成
  /gallery/    生成履歴（ブラウザ内保存）
  /common/     共通アセット
"""
import os
import sys

from flask import Flask, send_from_directory, redirect

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # 4K画像・複数参照画像に備えて 64MB

# --- API Blueprints ---
from routes import image_bp, video_bp, tts_bp, music_bp  # noqa: E402

app.register_blueprint(image_bp)
app.register_blueprint(video_bp)
app.register_blueprint(tts_bp)
app.register_blueprint(music_bp)


# --- 静的ページ ---
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


def _page(name):
    folder = os.path.join(FRONTEND_DIR, name)

    def page_index():
        return send_from_directory(folder, "index.html")

    def page_static(filename):
        return send_from_directory(folder, filename)

    app.add_url_rule(f"/{name}/", f"{name}_index", page_index)
    app.add_url_rule(f"/{name}/<path:filename>", f"{name}_static", page_static)


for _name in ("image", "video", "tts", "music", "gallery", "common"):
    _page(_name)


@app.route("/generate", methods=["POST"])
def legacy_generate():
    """旧エンドポイント互換: /generate → /api/image/generate"""
    return redirect("/api/image/generate", code=307)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
