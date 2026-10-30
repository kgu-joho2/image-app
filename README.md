# Gemini Studio — 画像 / 動画 / 音声 / 音楽 生成アプリ

Google Gemini API を使ったマルチメディア生成ツール集です。Flask バックエンド + 静的フロントエンドで、Docker で起動します。

| ページ | 機能 | モデル |
|---|---|---|
| `/` | ランチャー・最近の生成物 | — |
| `/image/` | 画像生成・会話しながら編集、アスペクト比・解像度（〜4K）、Google検索グラウンディング | `gemini-3.1-flash-lite-image` / `gemini-3.1-flash-image` / `gemini-3-pro-image` |
| `/gpt-image/` | **OpenAI** 画像生成・画像編集（参照画像16枚まで）、PPTX の各スライドを作り直して新しい PPTX / 画像として出力 | `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` |
| `/video/` | テキスト→動画、最初/最後フレーム指定、参照画像（3枚）、動画の延長、音声生成 | `veo-3.1-*-generate-preview` |
| `/tts/` | 30音声・感情タグ・2話者会話・文書からの読み上げ・要約 | `gemini-3.8-flash-lite-tts` / `gemini-3.8-flash-tts` / `gemini-3.1-flash-tts-preview` |
| `/music/` | 楽曲生成（30秒クリップ／フル尺、歌詞付き可）、プロンプトビルダー | `lyria-3-clip-preview` / `lyria-3-pro-preview` |
| `/gallery/` | 生成履歴（**ブラウザ内 IndexedDB に保存**。サーバーには保存しません） | — |

## セットアップ

```bash
cp backend/.env.example backend/.env   # GOOGLE_API_KEY を設定（GPT画像を使う場合は OPENAI_API_KEY も）
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
  openai_client.py    OpenAI Images API ラッパー（GPT Image 2.5）、サイズ計算
  pptx_tools.py       PPTX → スライド画像（LibreOffice + PyMuPDF）+ テキスト/ノート抽出、画像 → PPTX 組み立て
  routes/
    image.py          POST /api/image/generate   GET /api/image/models
    video.py          POST /api/video/jobs  GET /api/video/jobs/<id>  GET /api/video/models
    tts.py            POST /api/tts/generate|preview-voice|summarize|extract-text  GET /api/tts/options
    music.py          POST /api/music/generate   GET /api/music/models
    gpt_image.py      POST /api/gpt-image/generate|slide|pptx/parse|pptx/plan|pptx/build  GET /api/gpt-image/models
  tts_service.py      TTS・文書抽出・要約
  check_models.py     モデル疎通確認
frontend/
  common/             base.css（デザインシステム・ダークモード）, nav.js, ui.js, history.js（IndexedDB）
  image/ gpt-image/ video/ tts/ music/ gallery/  各ページ
```

## API メモ

- 画像・音楽・（必要なら）TTS は **Interactions API** (`client.interactions.create`) を使用。SDK が未対応の場合は REST (`/v1beta/interactions`) にフォールバックします。
- 画像の `response_format.mime_type` は現在 `image/jpeg` のみ対応。
- 動画は `generate_videos` の長時間オペレーションをジョブID方式でポーリングします。生成済み動画はサーバー側に2日間保持され、その間「延長」に使えます。
- 環境変数 `GEMINI_TEXT_MODEL` でプロンプト整形用テキストモデルを変更できます（既定 `gemini-3.6-flash`、404 時は `gemini-2.5-flash` 等へフォールバック）。

### GPT画像 / PPTX スライド再作成

- `OPENAI_API_KEY` が未設定でもアプリは起動します（`/gpt-image/` に警告を表示し、生成は無効）。
- スライド再作成は 2 段階です（ChatGPT アプリと同じく「どう見せるか」を汎用モデルが考えてから画像化）。
  1. **演出プラン** `POST /api/gpt-image/pptx/plan` — 汎用モデルが元スライド画像とテキスト・表・ノートを読み、デッキ共通のデザイン（配色・書体・イラストのタッチ）と各スライドの見せ方（人物・図解・グラフ化・構図）を構造化出力で提案。画面でモデルを選べます: **Gemini Flash-Lite**（既定 `gemini-3.1-flash-lite`、約10秒・安価）/ **Gemini Flash**（`gemini-3.8-flash`、丁寧・約1分）/ **GPT**（Responses API、`OPENAI_PLANNER_MODEL` 既定 `gpt-6-astra`）。Gemini は `GOOGLE_API_KEY` で動き OpenAI のクレジットを使いません。10 枚ごとに分割し、2 回目以降は共通デザインを固定して並列実行。画面上で編集できます。
  2. **画像生成** `POST /api/gpt-image/slide` — 元スライド画像は**入力しない**で `images.generate` で新規作成（GPT Image 2 以降は入力画像を常に高忠実度で扱うため、渡すと元のレイアウトに引きずられる）。文言は 1 行ずつ「そのまま描画」と指定し、表は数値データとして渡します。
- 統一感: 全スライドに共通デザインを適用し、「最初に完成したスライドを見本にする」がオンなら 2 枚目以降は `images.edit` でその画像を**スタイル参照のみ**として渡します（構図はコピーしない指示付き）。ロゴ等の参考画像も同様。
- 写真・グラフを含むスライドは「元スライドの写真・グラフを素材として使う」がオンになり、元画像を素材として追加で渡します。
- PPTX は一時ディレクトリで処理して即削除。生成結果はブラウザ内に保持し、`/api/gpt-image/pptx/build` で画像を全面配置した PPTX（ノート引継ぎ）を組み立ててダウンロードします。
- サイズは幅・高さとも 16 の倍数、長辺 3840 まで（2560x1440 超は実験的）。スライドの縦横比に合わせて自動計算します。
- Docker イメージに `libreoffice-impress` と `fonts-noto-cjk`（日本語描画用）が入っています。

TTS の詳細は [README_TTS.md](README_TTS.md) を参照してください。
