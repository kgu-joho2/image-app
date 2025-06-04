# Gemini Text-to-Speech アプリケーション

Google Gemini API を活用した Text-to-Speech（TTS）アプリケーションです。テキスト入力や文書アップロードから自然な音声を生成できます。

## 機能

### 主な機能

- **テキスト入力**: 直接テキストを入力して音声化
- **文書アップロード**: PDF、DOCX、PPTX、TXT、画像ファイルからテキストを抽出
- **単一話者・複数話者対応**: 最大 2 名の話者による対話形式の音声生成
- **音声カスタマイズ**: 音声選択、スタイル指定、話速調整
- **要約機能**: 長い文書内容の要約生成

### 対応ファイル形式

- PDF (テキスト・スキャン PDF)
- Microsoft Word (DOCX)
- Microsoft PowerPoint (PPTX)
- プレーンテキスト (TXT)
- 画像ファイル (JPG, PNG) - OCR 処理

### 音声機能

- **利用可能音声**: Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr
- **話速調整**: 0.25 倍〜4 倍速
- **スタイル制御**: 自然言語での音声スタイル指定
- **出力形式**: WAV, MP3

## セットアップ

### 必要な依存関係

```bash
cd backend
pip install -r requirements.txt
```

### 環境変数設定

#### ローカル環境

`.env`ファイルを作成し、以下の設定を追加：

```env
# 必須: Google Gemini API Key
GOOGLE_API_KEY=your_gemini_api_key_here

# オプション: Google Cloud機能を使用する場合
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
GOOGLE_CLOUD_PROJECT_ID=your_project_id
DOCUMENT_AI_PROCESSOR_ID=your_document_ai_processor_id
DOCUMENT_AI_LOCATION=us
```

#### Docker 環境

1. `backend/.env.example`を`backend/.env`にコピー
2. `.env`ファイルを編集して Google API Key を設定：

```env
GOOGLE_API_KEY=your_actual_api_key_here
```

#### Google Cloud 機能の設定（オプション）

高度な文書処理や OCR 機能を使用する場合：

1. Google Cloud Console でサービスアカウントキーを作成
2. キーファイルをプロジェクトルートに配置（例：`credentials.json`）
3. 環境変数`GOOGLE_APPLICATION_CREDENTIALS`でファイルパスを指定

### API キーの取得

1. [Google AI Studio](https://makersuite.google.com/)にアクセス
2. API キーを作成
3. `.env`ファイルに設定

### アプリケーション実行

#### ローカル環境での実行

```bash
cd backend
python app.py
```

#### Docker 環境での実行

```bash
# 1. 環境変数ファイルを作成
cp backend/.env.example backend/.env
# .envファイルにGoogle API Keyを設定

# 2. Dockerイメージをビルドして起動
docker-compose up --build

# または、バックグラウンドで起動
docker-compose up -d --build

# 3. 停止する場合
docker-compose down
```

アプリケーションは以下の URL で利用できます：

- 画像生成アプリ: http://localhost:5000/
- TTS アプリ: http://localhost:5000/tts/

## 使用方法

### 1. テキスト入力による音声生成

1. TTS アプリ (http://localhost:5000/tts/) にアクセス
2. 「テキスト入力」モードを選択
3. 単一話者または複数話者を選択
4. テキストエリアにテキストを入力
5. 音声設定を調整
6. 「音声を生成」ボタンをクリック

### 2. 文書アップロードによる音声生成

1. 「文書アップロード」モードを選択
2. 対応ファイルをドラッグ&ドロップまたは選択
3. 自動的にテキストが抽出されます
4. 必要に応じて「要約を生成」ボタンで要約作成
5. 音声設定を調整して生成

### 3. 複数話者での音声生成

1. 「複数話者（最大 2 名）」を選択
2. 話者 A と話者 B の音声を設定
3. テキストを以下の形式で入力：

```
話者A: こんにちは。今日の天気はいかがですか？
話者B: 晴れていて気持ちがいいですね。
話者A: そうですね。散歩日和です。
```

## API エンドポイント

### TTS 関連 API

- `POST /api/tts/extract-text` - ファイルからテキスト抽出
- `POST /api/tts/summarize` - テキスト要約
- `POST /api/tts/preview-voice` - 音声プレビュー
- `POST /api/tts/generate` - 音声生成

## トラブルシューティング

### よくある問題

1. **音声が生成されない**

   - Gemini API キーが正しく設定されているか確認
   - ネットワーク接続を確認

### ⚠️ 重要なお知らせ: TTS 機能について

**現在の状態**: Gemini TTS API（Text-to-Speech）機能は、Google の `google-generativeai` パッケージでまだ完全にサポートされていません。現在のバージョン（0.8.5）では、TTS 関連の API（`SpeechConfig`、`VoiceConfig` 等）が利用できません。

**影響する機能**:

- 音声プレビュー機能
- 音声生成機能（単一話者・複数話者）

**代替案と今後の対応**:

1. **テキスト抽出・要約機能は正常動作**: 文書アップロードからのテキスト抽出と要約生成は問題なく利用できます
2. **API 更新待ち**: Google が TTS 機能を正式リリースした際に、コードは自動的に有効になります
3. **将来のアップデート**: `google-generativeai` パッケージが TTS 機能をサポート次第、この機能は復旧予定です

**現在利用可能な機能**:

- ✅ PDF、DOCX、PPTX、TXT、画像ファイルからのテキスト抽出
- ✅ 抽出したテキストの要約生成
- ✅ 複数話者対応の UI（将来の TTS 復旧に備えて）
- ❌ 音声プレビュー（一時的に無効）
- ❌ 音声生成（一時的に無効）

### その他の問題

2. **ファイルアップロードが失敗する**

   - ファイル形式が対応しているか確認
   - ファイルサイズが 50MB 以内か確認

3. **OCR が動作しない**
   - Google Cloud Vision API の設定を確認
   - サービスアカウントキーが正しく設定されているか確認

### Docker 環境での問題

4. **コンテナが起動しない**

   ```bash
   # ログを確認
   docker-compose logs image-app

   # イメージを再ビルド
   docker-compose down
   docker-compose up --build
   ```

5. **TTS 機能が「利用できません」と表示される**

   - コンテナ内で Python 依存関係が正しくインストールされているか確認
   - ログで TTS サービス初期化エラーを確認：

   ```bash
   docker-compose logs image-app | grep "TTS"
   ```

6. **ファイルアップロード時のエラー**

   - Docker 内でのファイル権限問題の可能性
   - ボリュームマウントが正しく設定されているか確認

7. **依存関係のエラー**
   ```bash
   # コンテナを完全に再ビルド
   docker-compose down
   docker system prune -a
   docker-compose up --build
   ```

### 高度な機能

Google Cloud Document AI や Vision API を使用することで、より高度なテキスト抽出や OCR 機能を利用できます。詳細は[RFP 文書](rfp.md)を参照してください。

## 技術仕様

- **フロントエンド**: HTML, CSS, JavaScript (Vanilla)
- **バックエンド**: Python Flask
- **AI API**: Google Gemini API (TTS 機能)
- **文書処理**: Google Cloud Document AI (オプション)
- **OCR**: Google Cloud Vision API (オプション)

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。

## 🎯 TTS 機能の最新状況

### ✅ 完全復旧！利用可能な機能

**Gemini 2.5 TTS API が正常に動作しています！**

- ✅ **音声プレビュー機能**: 30 種類の音声オプションで音声プレビューが可能
- ✅ **音声生成機能**: 単一話者・複数話者対応の音声生成
- ✅ **PDF、DOCX、PPTX、TXT、画像ファイルからのテキスト抽出**
- ✅ **抽出したテキストの要約生成**
- ✅ **複数話者対応の UI（最大 2 名の話者）**
- ✅ **音声スタイル制御**（自然言語での指示）
- ✅ **読み上げ速度調整**（0.25x-4x）

### 🔧 技術仕様

**対応モデル**:

- `gemini-2.5-flash-preview-tts`
- `gemini-2.5-pro-preview-tts`

**音声オプション（30 種類）**:

- Zephyr（明るい）、Kore（堅実）、Puck（陽気）、Fenrir（興奮）
- Enceladus（息遣い）、Charon（情報的）、Leda（若々しい）
- Aoede（軽やか）、Callirhoe（穏やか）、Autonoe（明るい）
- Iapetus（明瞭）、Umbriel（穏やか）、Algieba（滑らか）など

**対応言語（24 言語）**:

- 日本語（ja-JP）、英語（en-US）、中国語、フランス語、ドイツ語、スペイン語など

### ⚠️ 重要なお知らせ

**Preview 版について**: Gemini 2.5 TTS API はまだ Preview 版です。正式版リリースまでに仕様変更の可能性があります。

### 🚀 使用方法

#### Docker 環境での起動手順：

1. **環境変数設定**：

```bash
# .envファイルを作成
cp backend/.env.example backend/.env
# .envファイルを編集してGoogle API Keyを設定
```

2. **起動方法**：

```bash
# 起動スクリプト使用
./docker-start.sh

# または直接docker-compose
docker-compose up --build -d
```

3. **アクセス URL**：

- 画像生成アプリ: http://localhost:5000/
- **TTS アプリ: http://localhost:5000/tts/**

### 💡 使い方のコツ

**音声スタイルの指定例**:

- "明るく元気に読んでください"
- "落ち着いたトーンで話してください"
- "ニュースキャスターのように読んでください"
- "物語を読み聞かせるように優しく"

### 🎭 複数話者機能の詳細

**自動話者分割（改行ベース）**:
複数話者モードでは、テキストに話者指定がない場合、**改行ごとに自動的に話者 A、話者 B が交互に割り当て**られます。

```
入力例1: 自動分割
おはようございます
はい、おはようございます
今日の会議の件ですが
10時からですね

↓ 自動変換後：
話者A: おはようございます
話者B: はい、おはようございます
話者A: 今日の会議の件ですが
話者B: 10時からですね
```

**手動話者指定**:
以下のキーワードが含まれている場合は、手動指定として認識され、自動変換されません：

- `:` （コロン）
- `：` （全角コロン）
- `話者`
- `Speaker`

```
入力例2: 手動指定（A:、B:形式）
A: こんにちは、田中です
B: 佐藤です、よろしくお願いします
A: 今日の資料は準備できていますか？
B: はい、すべて用意しました

入力例3: 日本語話者指定
話者A: いらっしゃいませ
話者B: ありがとうございます
話者A: 本日はどのようなご用件でしょうか？

入力例4: 英語話者指定
Speaker1: Hello, how are you?
Speaker2: I'm fine, thank you
Speaker1: What's the agenda for today?
```

**複数話者モードの特徴**:

- 最大 2 名の話者に対応
- 各話者に異なる音声を設定可能
- 自然な会話形式での音声生成
- 長いテキストでも話者が自動的に交互に切り替わる

**複数話者のテキスト形式**:

```
田中: おはようございます。今日の会議の件ですが。
佐藤: はい、10時からですね。準備はできています。
田中: ありがとうございます。資料の方はいかがですか？
```
