# Gemini Studio — 画像 / 動画 / 音声 / 音楽 生成アプリ

Google Gemini API を使ったマルチメディア生成ツール集です。Flask バックエンド + 静的フロントエンドで、Docker で起動します。

| ページ | 機能 | モデル |
|---|---|---|
| `/` | ランチャー・最近の生成物 | — |
| `/image/` | 画像生成・会話しながら編集、アスペクト比・解像度（〜4K）、Google検索グラウンディング | `gemini-3.1-flash-lite-image` / `gemini-3.1-flash-image` / `gemini-3-pro-image` |
| `/video/` | テキスト→動画、最初/最後フレーム指定、参照画像（3枚）、動画の延長、音声生成 | `veo-3.1-*-generate-preview` |
| `/tts/` | 30音声・感情タグ・2話者会話・文書からの読み上げ・要約 | `gemini-3.8-flash-lite-tts` / `gemini-3.8-flash-tts` / `gemini-3.1-flash-tts-preview` |
| `/music/` | 楽曲生成（30秒クリップ／フル尺、歌詞付き可）、プロンプトビルダー | `lyria-3-clip-preview` / `lyria-3-pro-preview` |
| `/gallery/` | 生成履歴（**ブラウザ内 IndexedDB に保存**。サーバーには保存しません） | — |

## セットアップ

```bash
cp backend/.env.example backend/.env   # GOOGLE_API_KEY を設定
docker compose up --build -d
# http://localhost:5000/
```

### モデルの利用可否を確認する

```bash
docker compose exec image-app python backend/check_models.py         # 一覧で確認
docker compose exec image-app python backend/check_models.py --live  # 実際に最小リクエスト（課金対象）
```

## 構成

```
backend/
  app.py              Flask エントリポイント（静的配信 + Blueprint 登録）
  gemini_client.py    google.genai クライアント、Interactions API ラッパー、プロンプト整形、共通エラー処理
  routes/
    image.py          POST /api/image/generate   GET /api/image/models
    video.py          POST /api/video/jobs  GET /api/video/jobs/<id>  GET /api/video/models
    tts.py            POST /api/tts/generate|preview-voice|summarize|extract-text  GET /api/tts/options
    music.py          POST /api/music/generate   GET /api/music/models
  tts_service.py      TTS・文書抽出・要約
  check_models.py     モデル疎通確認
frontend/
  common/             base.css（デザインシステム・ダークモード）, nav.js, ui.js, history.js（IndexedDB）
  image/ video/ tts/ music/ gallery/  各ページ
```

## API メモ

- 画像・音楽・（必要なら）TTS は **Interactions API** (`client.interactions.create`) を使用。SDK が未対応の場合は REST (`/v1beta/interactions`) にフォールバックします。
- 画像の `response_format.mime_type` は現在 `image/jpeg` のみ対応。
- 動画は `generate_videos` の長時間オペレーションをジョブID方式でポーリングします。生成済み動画はサーバー側に2日間保持され、その間「延長」に使えます。
- 環境変数 `GEMINI_TEXT_MODEL` でプロンプト整形用テキストモデルを変更できます（既定 `gemini-3.6-flash`、404 時は `gemini-2.5-flash` 等へフォールバック）。

TTS の詳細は [README_TTS.md](README_TTS.md) を参照してください。
