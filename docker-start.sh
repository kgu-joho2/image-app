#!/bin/bash

# TTS機能付きImage Appの起動スクリプト

echo "🚀 Gemini Image & TTS App Docker起動スクリプト"
echo "================================================"

# .envファイルの確認
if [ ! -f "backend/.env" ]; then
    echo "❌ backend/.envファイルが見つかりません"
    echo "📝 backend/.env.exampleをコピーして設定してください："
    echo "   cp backend/.env.example backend/.env"
    echo "   # .envファイルを編集してGOOGLE_API_KEYを設定"
    exit 1
fi

# API Keyの確認
if ! grep -q "^GOOGLE_API_KEY=.*[^=]$" backend/.env; then
    echo "⚠️  GOOGLE_API_KEYが設定されていない可能性があります"
    echo "📝 backend/.envファイルでGoogle API Keyを設定してください"
    echo ""
    read -p "続行しますか？ (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "🔧 Dockerコンテナをビルド・起動中..."

# Docker Composeで起動
docker-compose up --build -d

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ アプリケーションが正常に起動しました！"
    echo ""
    echo "🌐 アクセスURL:"
    echo "   トップ(ランチャー): http://localhost:5000/"
    echo "   画像生成アプリ: http://localhost:5000/image/"
    echo "   TTSアプリ:      http://localhost:5000/tts/"
    echo "   動画生成アプリ: http://localhost:5000/video/"
    echo "   音楽生成アプリ: http://localhost:5000/music/"
    echo "   ギャラリー:     http://localhost:5000/gallery/"
    echo ""
    echo "🔎 モデル利用可否の確認: docker compose exec image-app python backend/check_models.py"
    echo ""
    echo "📊 コンテナの状態確認:"
    docker-compose ps
    echo ""
    echo "📝 ログを確認: docker-compose logs -f image-app"
    echo "🛑 停止方法:   docker-compose down"
else
    echo "❌ 起動に失敗しました。ログを確認してください："
    echo "   docker-compose logs image-app"
fi 