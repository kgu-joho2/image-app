/* 共通UIユーティリティ: トースト / モーダル / API呼び出し / 変換 / ダウンロード */
window.UI = (function () {
  // ---------- toast ----------
  let wrap = null;
  function toast(message, type = "info", ms = 4200) {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- modal ----------
  function modal(contentEl, { small = false } = {}) {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    const box = document.createElement("div");
    box.className = "modal" + (small ? " small" : "");
    if (typeof contentEl === "string") box.innerHTML = contentEl;
    else box.appendChild(contentEl);
    back.appendChild(box);
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
    document.body.appendChild(back);
    return { close, box };
  }

  function quotaPopup(message) {
    const m = modal(`
      <div style="font-size:44px">⚠️</div>
      <h3>利用上限に達しました</h3>
      <p class="muted">${escapeHtml(message)}</p>
      <button class="btn btn-primary" data-close>閉じる</button>`, { small: true });
    m.box.querySelector("[data-close]").addEventListener("click", m.close);
  }

  // ---------- API ----------
  class ApiError extends Error {
    constructor(message, { status, type } = {}) { super(message); this.status = status; this.type = type; }
  }
  async function api(url, { method = "POST", body, signal } = {}) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const type = data.error_type || (res.status === 429 ? "quota_exceeded" : undefined);
      throw new ApiError(data.error || `HTTP ${res.status}`, { status: res.status, type });
    }
    return data;
  }
  function handleError(e, fallback = "エラーが発生しました") {
    console.error(e);
    if (e && e.type === "quota_exceeded") quotaPopup(e.message);
    else toast(e && e.message ? e.message : fallback, "error", 7000);
  }

  // ---------- conversions ----------
  function dataURLToBlob(dataURL, defaultMime = "application/octet-stream") {
    const [head, b64] = dataURL.split(",");
    const m = head.match(/:(.*?);/);
    const mime = (m && m[1]) || defaultMime;
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  async function blobToBase64(blob) {
    const d = await blobToDataURL(blob);
    return d.split(",")[1];
  }
  async function fileToInput(file) {
    const dataUrl = await blobToDataURL(file);
    return { mime_type: file.type || "image/png", data: dataUrl.split(",")[1], previewUrl: dataUrl, name: file.name };
  }
  function download(blobOrUrl, filename) {
    const url = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof blobOrUrl !== "string") setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function extFromMime(mime) {
    const map = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4",
      "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };
    return map[mime] || (mime.split("/")[1] || "bin");
  }
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle("loading", loading);
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // 画像をリサイズ（送信サイズ抑制用・最大辺 maxPx）
  async function shrinkImage(file, maxPx = 2048, quality = 0.92) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return fileToInput(file);
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return fileToInput(file);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    if (scale === 1) { bmp.close?.(); return fileToInput(file); }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const dataUrl = c.toDataURL(mime, quality);
    return { mime_type: mime, data: dataUrl.split(",")[1], previewUrl: dataUrl, name: file.name };
  }

  // 波形描画
  async function drawWaveform(canvas, blob) {
    try {
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth || 600, H = canvas.clientHeight || 72;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const data = buf.getChannelData(0);
      const bars = Math.floor(W / 3);
      const step = Math.floor(data.length / bars);
      ctx.clearRect(0, 0, W, H);
      const color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#1a73e8";
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) { const v = Math.abs(data[i * step + j] || 0); if (v > max) max = v; }
        const h = Math.max(2, max * H * 0.95);
        ctx.fillRect(i * 3, (H - h) / 2, 2, h);
      }
      ac.close();
      return buf.duration;
    } catch (e) { console.warn("waveform failed", e); return null; }
  }

  return { toast, modal, quotaPopup, api, ApiError, handleError, dataURLToBlob, base64ToBlob, blobToDataURL,
    blobToBase64, fileToInput, shrinkImage, download, extFromMime, stamp, setLoading, escapeHtml, fmtTime, drawWaveform };
})();
