/* 画像生成ページ — /api/image/generate (Interactions API) */
(function () {
  const $ = (id) => document.getElementById(id);
  const thread = $("thread"), promptEl = $("prompt"), sendBtn = $("send"), uploadEl = $("image-upload"),
    inputThumbs = $("input-thumbs"), aspectChips = $("aspect-chips"), sizeChips = $("size-chips"),
    modelHint = $("model-hint"), sessionBadge = $("session-badge"), uploadHint = $("upload-hint");

  const MODEL_INFO = {
    "flash-lite": { label: "Gemini 3.1 Flash Lite Image", desc: "最速・低コスト。1Kのみ。" },
    flash: { label: "Gemini 3.1 Flash Image", desc: "標準。4K・文字描画・検索グラウンディング対応。" },
    pro: { label: "Gemini 3 Pro Image", desc: "最高品質。複雑な構図・ブランド一貫性向け。" },
  };
  let cfg = { models: [], aspect_ratios: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], max_input_images: 14 };
  let aspect = "1:1", size = "1K";
  let inputs = [];           // 添付画像 [{mime_type,data,previewUrl}]
  let interactionId = null;  // マルチターン編集用
  let lastImage = null;      // {blob, mime, prompt}

  // ---------- 設定 ----------
  function modelKey() { return document.querySelector('input[name="model"]:checked').value; }
  function modelCfg() { return cfg.models.find((m) => m.key === modelKey()) || { sizes: ["1K"], search: false, thinking: false }; }
  function renderChips(container, values, current, onPick) {
    container.innerHTML = "";
    values.forEach((v) => {
      const c = document.createElement("span");
      c.className = "chip" + (v === current ? " on" : "");
      c.textContent = v;
      c.addEventListener("click", () => onPick(v));
      container.appendChild(c);
    });
  }
  function renderSettings() {
    const m = modelCfg();
    renderChips(aspectChips, cfg.aspect_ratios, aspect, (v) => { aspect = v; renderSettings(); });
    if (!m.sizes.includes(size)) size = m.sizes.includes("1K") ? "1K" : m.sizes[0];
    renderChips(sizeChips, m.sizes, size, (v) => { size = v; renderSettings(); });
    const info = MODEL_INFO[modelKey()] || {};
    modelHint.textContent = `${info.label || m.id || ""} — ${info.desc || ""}`;
    $("opt-search").disabled = !m.search;
    $("opt-thinking").disabled = !m.thinking;
    if (!m.search) $("opt-search").checked = false;
    if (!m.thinking) $("opt-thinking").checked = false;
    uploadHint.textContent = inputs.length ? `${inputs.length}枚添付中` : `最大${cfg.max_input_images}枚まで`;
  }
  document.querySelectorAll('input[name="model"]').forEach((r) => r.addEventListener("change", renderSettings));

  async function loadConfig() {
    try {
      const d = await UI.api("/api/image/models", { method: "GET" });
      cfg = { ...cfg, ...d };
    } catch (e) {
      console.warn("config fallback", e);
      cfg.models = [
        { key: "flash-lite", sizes: ["1K"], search: false, thinking: false },
        { key: "flash", sizes: ["512", "1K", "2K", "4K"], search: true, thinking: true },
        { key: "pro", sizes: ["1K", "2K", "4K"], search: true, thinking: true },
      ];
    }
    renderSettings();
  }

  // ---------- 添付 ----------
  uploadEl.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    const room = cfg.max_input_images - inputs.length;
    if (files.length > room) UI.toast(`添付は最大${cfg.max_input_images}枚までです`, "warn");
    for (const f of files.slice(0, Math.max(0, room))) inputs.push(await UI.shrinkImage(f));
    renderInputs();
    e.target.value = null;
  });
  function renderInputs() {
    inputThumbs.innerHTML = "";
    inputs.forEach((img, i) => {
      const t = document.createElement("div");
      t.className = "thumb";
      t.innerHTML = `<img src="${img.previewUrl}" alt="input ${i + 1}" /><button class="rm" title="削除">×</button>`;
      t.querySelector(".rm").addEventListener("click", () => { inputs.splice(i, 1); renderInputs(); });
      inputThumbs.appendChild(t);
    });
    renderSettings();
  }
  // ペースト/ドロップ対応
  document.addEventListener("paste", async (e) => {
    const items = Array.from(e.clipboardData?.items || []).filter((it) => it.type.startsWith("image/"));
    if (!items.length) return;
    for (const it of items) inputs.push(await UI.shrinkImage(it.getAsFile()));
    renderInputs();
    UI.toast("画像を添付しました", "success", 1800);
  });
  promptEl.addEventListener("dragover", (e) => e.preventDefault());
  promptEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    for (const f of files) inputs.push(await UI.shrinkImage(f));
    renderInputs();
  });

  // ---------- セッション ----------
  function setSession(id) {
    interactionId = id;
    sessionBadge.textContent = id ? "編集を継続中" : "新規";
    sessionBadge.className = "badge" + (id ? " primary" : "");
    $("session-hint").textContent = id
      ? "次の指示は直前の生成画像への編集として送られます。別の画像を作るには「新しいセッション」を押してください。"
      : "生成後に続けて指示すると、直前の画像を編集します。";
  }
  $("new-session").addEventListener("click", () => {
    setSession(null);
    inputs = [];
    renderInputs();
    thread.innerHTML = "";
    addAssistant("新しいセッションを開始しました。生成したい画像のイメージを入力してください。");
    promptEl.focus();
  });

  // ---------- スレッド描画 ----------
  function addTurn(cls) {
    const t = document.createElement("div");
    t.className = `turn ${cls}`;
    thread.appendChild(t);
    thread.parentElement.scrollIntoView({ behavior: "smooth", block: "end" });
    return t;
  }
  function addAssistant(text) {
    const t = addTurn("assistant");
    t.innerHTML = `<div class="bubble">${UI.escapeHtml(text)}</div>`;
    return t;
  }
  function addUser(text, imgs) {
    const t = addTurn("user");
    let html = "";
    if (imgs.length) html += `<div class="thumbs">${imgs.map((i) => `<img src="${i.previewUrl}" />`).join("")}</div>`;
    if (text) html += `<div class="bubble">${UI.escapeHtml(text)}</div>`;
    t.innerHTML = html;
  }
  function addSkeleton() {
    const t = addTurn("assistant gen-image");
    t.innerHTML = `<div class="skeleton"></div><div class="hint">生成中… ${size === "4K" ? "4Kは1分以上かかることがあります" : ""}</div>`;
    return t;
  }

  function renderResult(turn, data, promptText) {
    turn.innerHTML = "";
    const text = data.results.filter((r) => r.type === "text").map((r) => r.content).join("\n").trim();
    const images = data.results.filter((r) => r.type === "image");
    if (text) {
      const b = document.createElement("div");
      b.className = "bubble";
      b.textContent = text;
      turn.appendChild(b);
    }
    images.forEach((img, idx) => {
      const blob = UI.dataURLToBlob(img.content, "image/jpeg");
      const url = URL.createObjectURL(blob);
      const box = document.createElement("div");
      box.innerHTML = `
        <div class="result-media"><img src="${url}" alt="generated ${idx + 1}" /></div>
        <div class="meta">
          <span class="badge">${UI.escapeHtml(MODEL_INFO[modelKey()]?.label || data.model)}</span>
          <span class="badge">${aspect} / ${size}</span>
        </div>
        <div class="result-actions">
          <button class="btn btn-secondary btn-sm" data-act="edit">✏️ この画像を編集</button>
          <button class="btn btn-secondary btn-sm" data-act="attach">📎 入力に使う</button>
          <button class="btn btn-secondary btn-sm" data-act="video">🎬 動画にする</button>
          <button class="btn btn-secondary btn-sm" data-act="music">🎵 音楽にする</button>
          <button class="btn btn-secondary btn-sm" data-act="dl">⬇️ ダウンロード</button>
        </div>
        <details><summary>送信したプロンプト</summary><pre>${UI.escapeHtml(data.prompt_used || promptText)}</pre></details>`;
      box.querySelector("img").addEventListener("click", () => {
        const im = document.createElement("img");
        im.src = url; im.style.maxWidth = "100%"; im.style.maxHeight = "85vh"; im.style.display = "block"; im.style.margin = "0 auto";
        UI.modal(im);
      });
      const payload = { blob, mime: blob.type, prompt: data.prompt_used || promptText, previewUrl: url };
      box.addEventListener("click", async (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        if (act === "edit") { setSession(data.interaction_id); promptEl.placeholder = "例: 背景を夜にして、看板の文字を赤くする"; promptEl.focus(); }
        if (act === "attach") { inputs.push({ mime_type: blob.type, data: img.content.split(",")[1], previewUrl: url }); renderInputs(); UI.toast("入力に追加しました", "success", 1800); }
        if (act === "video") History.sendTo("video", { blob, mime: blob.type, prompt: promptText });
        if (act === "music") History.sendTo("music", { blob, mime: blob.type, prompt: promptText });
        if (act === "dl") UI.download(blob, `image_${UI.stamp()}.${UI.extFromMime(blob.type)}`);
      });
      turn.appendChild(box);
      lastImage = payload;
      History.add({ type: "image", blob, mime: blob.type, prompt: promptText, meta: { model: data.model, aspect, size, prompt_used: data.prompt_used } });
    });
    thread.parentElement.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  // ---------- 生成 ----------
  async function generate() {
    const text = promptEl.value.trim();
    if (!text && !inputs.length) { UI.toast("プロンプトを入力するか画像を添付してください", "warn"); return; }
    const sentInputs = inputs.slice();
    addUser(text, sentInputs);
    const skel = addSkeleton();
    UI.setLoading(sendBtn, true);
    const body = {
      prompt: text,
      images_data: sentInputs.map((i) => ({ mime_type: i.mime_type, data: i.data })),
      previous_interaction_id: interactionId,
      options: {
        model: modelKey(), aspect_ratio: aspect, image_size: size,
        enhance_prompt: $("opt-enhance").checked,
        google_search: $("opt-search").checked,
        thinking_level: $("opt-thinking").checked ? "high" : undefined,
      },
    };
    try {
      const data = await UI.api("/api/image/generate", { body });
      renderResult(skel, data, text);
      if (data.interaction_id) setSession(data.interaction_id);
      promptEl.value = "";
      inputs = [];
      renderInputs();
    } catch (e) {
      skel.className = "turn assistant error";
      skel.innerHTML = `<div class="bubble">⚠️ ${UI.escapeHtml(e.message)}</div><div class="result-actions"><button class="btn btn-secondary btn-sm" id="retry">もう一度送信</button></div>`;
      skel.querySelector("#retry").addEventListener("click", () => { skel.remove(); generate(); });
      if (e.type === "quota_exceeded") UI.quotaPopup(e.message);
      // 入力は残す（再送できるように）
    } finally {
      UI.setLoading(sendBtn, false);
    }
  }
  sendBtn.addEventListener("click", generate);
  promptEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); generate(); }
  });

  // ---------- 他ページからの受け渡し ----------
  async function takeHandoff() {
    const h = await History.handoffTake("image");
    if (!h) return;
    if (h.blob) {
      const dataUrl = await UI.blobToDataURL(h.blob);
      inputs.push({ mime_type: h.mime || h.blob.type, data: dataUrl.split(",")[1], previewUrl: dataUrl });
      renderInputs();
    }
    if (h.prompt) promptEl.value = h.prompt;
    UI.toast("ギャラリーから読み込みました", "success", 2000);
  }

  loadConfig().then(takeHandoff);
})();
