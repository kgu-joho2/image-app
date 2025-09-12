const modeRadios = document.querySelectorAll('input[name="video-input-mode"]');
const textMode = document.getElementById("text-mode");
const imageMode = document.getElementById("image-mode");
const promptInput = document.getElementById("video-prompt");
const imageUpload = document.getElementById("video-image-upload");
const imagePreviewArea = document.getElementById("video-image-preview-area");
const generateButton = document.getElementById("generate-video");
const resultSection = document.getElementById("video-result");
const resultVideo = document.getElementById("result-video");
const downloadBtn = document.getElementById("download-video");
const newBtn = document.getElementById("new-video");

// Options UIは削除されたため、参照を無効化
const optDuration = null;
const optAspect = null;
const optFps = null;
const optStyle = null;
const optStyleSelect = null;
const imageModePrompt = document.getElementById("video-image-prompt");

let selectedImages = [];

modeRadios.forEach((r) =>
  r.addEventListener("change", () => {
    const mode = document.querySelector(
      'input[name="video-input-mode"]:checked'
    ).value;
    if (mode === "text") {
      textMode.style.display = "block";
      imageMode.style.display = "none";
    } else {
      textMode.style.display = "none";
      imageMode.style.display = "block";
    }
  })
);

imageUpload.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);

  // 動画生成では1枚のみアップロード可能
  if (files.length > 1) {
    alert(
      "動画生成では画像を1枚のみアップロードできます。最初の画像のみが使用されます。"
    );
  }

  // 既存の画像をクリアして、新しい画像（最初の1枚のみ）を追加
  selectedImages = [];

  if (files.length > 0) {
    const file = files[0]; // 最初の1枚のみ
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(",")[1];
      selectedImages.push({
        mime_type: file.type,
        data: base64,
        previewUrl: dataUrl,
      });
      renderPreviews();
    };
    reader.readAsDataURL(file);
  }
  e.target.value = null;
});

function renderPreviews() {
  imagePreviewArea.innerHTML = "";
  if (selectedImages.length > 0) {
    imagePreviewArea.style.display = "flex";
  }
  selectedImages.forEach((img, idx) => {
    const tag = document.createElement("img");
    tag.src = img.previewUrl;
    tag.alt = `ref ${idx + 1}`;
    tag.style.height = "60px";
    tag.style.borderRadius = "6px";
    tag.style.border = "1px solid #cce0ff";
    imagePreviewArea.appendChild(tag);
  });
}

generateButton.addEventListener("click", async () => {
  const mode = document.querySelector(
    'input[name="video-input-mode"]:checked'
  ).value;
  let prompt = (promptInput.value || "").trim();
  if (mode === "text" && !prompt) {
    alert("テキストを入力してください");
    return;
  }
  if (mode === "image") {
    const imgPrompt = (imageModePrompt?.value || "").trim();
    if (selectedImages.length === 0) {
      alert("参照画像を少なくとも1枚選択してください");
      return;
    }
    if (!imgPrompt) {
      alert("画像に基づく動画の指示テキストを入力してください");
      return;
    }
    prompt = imgPrompt;
  }

  setLoading(true);
  try {
    const body = {
      prompt,
      images_data: selectedImages.map((i) => ({
        mime_type: i.mime_type,
        data: i.data,
      })),
      options: {},
    };

    const res = await fetch("/api/video/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // クォータエラーの特別処理
      if (err.error_type === "quota_exceeded" || res.status === 429) {
        throw new Error(
          `QUOTA_EXCEEDED:${err.error || "動画生成の利用上限に達しました。"}`
        );
      }
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const videoItem = (data.results || []).find((r) => r.type === "video");
    if (!videoItem) throw new Error("動画が返りませんでした");

    const { blob } = dataURLToBlob(videoItem.content);
    const objectUrl = URL.createObjectURL(blob);
    resultVideo.src = objectUrl;
    resultVideo.controls = true;
    resultVideo.volume = 1.0;
    resultSection.style.display = "block";
  } catch (e) {
    console.error(e);

    // クォータエラーの場合は専用のポップアップを表示
    if (e.message.startsWith("QUOTA_EXCEEDED:")) {
      const quotaMessage = e.message.replace("QUOTA_EXCEEDED:", "");
      showQuotaExceededPopup(quotaMessage);
    } else {
      alert(`エラー: ${e.message}`);
    }
  } finally {
    setLoading(false);
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!resultVideo.src) return;
  const a = document.createElement("a");
  a.href = resultVideo.src;
  a.download = `generated_video_${Date.now()}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

newBtn.addEventListener("click", () => {
  promptInput.value = "";
  selectedImages = [];
  renderPreviews();
  imagePreviewArea.style.display = "none";
  resultVideo.removeAttribute("src");
  resultSection.style.display = "none";
});

function setLoading(loading) {
  generateButton.disabled = loading;
  const text = generateButton.querySelector(".btn-text");
  const loadingEl = generateButton.querySelector(".btn-loading");
  if (text) text.style.display = loading ? "none" : "inline";
  if (loadingEl) loadingEl.style.display = loading ? "flex" : "none";
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function clamp(n, min, max) {
  if (typeof n !== "number") return undefined;
  return Math.max(min, Math.min(max, n));
}

function dataURLToBlob(dataURL) {
  const parts = dataURL.split(",");
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = (mimeMatch && mimeMatch[1]) || "video/mp4";
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return { blob: new Blob([u8arr], { type: mime }), mime };
}

// クォータエラー専用のポップアップ表示
function showQuotaExceededPopup(message) {
  // 既存のポップアップがあれば削除
  const existingPopup = document.getElementById("quota-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // ポップアップ要素を作成
  const popup = document.createElement("div");
  popup.id = "quota-popup";
  popup.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const popupContent = document.createElement("div");
  popupContent.style.cssText = `
    background: white;
    padding: 30px;
    border-radius: 12px;
    max-width: 400px;
    text-align: center;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    border: 2px solid #ff6b6b;
  `;

  const icon = document.createElement("div");
  icon.style.cssText = `
    font-size: 48px;
    margin-bottom: 16px;
    color: #ff6b6b;
  `;
  icon.textContent = "⚠️";

  const title = document.createElement("h3");
  title.style.cssText = `
    margin: 0 0 12px 0;
    color: #333;
    font-size: 18px;
  `;
  title.textContent = "利用上限に達しました";

  const messageEl = document.createElement("p");
  messageEl.style.cssText = `
    margin: 0 0 20px 0;
    color: #666;
    line-height: 1.4;
  `;
  messageEl.textContent = message;

  const button = document.createElement("button");
  button.style.cssText = `
    background-color: #007bff;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
  `;
  button.textContent = "閉じる";
  button.addEventListener("click", () => popup.remove());

  popupContent.appendChild(icon);
  popupContent.appendChild(title);
  popupContent.appendChild(messageEl);
  popupContent.appendChild(button);
  popup.appendChild(popupContent);

  // クリックで閉じる
  popup.addEventListener("click", (e) => {
    if (e.target === popup) {
      popup.remove();
    }
  });

  document.body.appendChild(popup);
}
