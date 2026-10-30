/* GPT画像ページ — /api/gpt-image/* (OpenAI GPT Image 2.5)
   タブ1: テキスト→画像 / 画像編集、タブ2: PPTX の各スライドを再作成して PPTX にまとめる */
(function () {
  const $ = (id) => document.getElementById(id);

  const MODEL_INFO = {
    flare: { label: "GPT Image 2.5 Flare", desc: "高速。普段使い・枚数の多いスライド向け。" },
    sunburst: { label: "GPT Image 2.5 Sunburst", desc: "高精細。細かい文字・図解・編集精度重視（時間がかかります）。" },
  };
  const QUALITY_LABEL = { auto: "自動", low: "低", medium: "中", high: "高", xhigh: "特高", max: "最高" };
  const EDGE_LABEL = { 1024: "1024", 1536: "1536", 2560: "2K (2560)", 3840: "4K (3840)" };
  const BG_LABEL = { auto: "自動", opaque: "不透明", transparent: "透過" };
  const STYLE_PRESETS = {
    シンプル: "minimal and clean, lots of white space, one accent color, modern sans-serif typography",
    ビジネス: "corporate business style, navy and gray palette, clear hierarchy, subtle icons",
    ポップ: "bright, friendly and colorful, rounded shapes, playful flat illustrations",
    インフォグラフィック: "infographic style, convert content into diagrams, icons, charts and visual flows",
    講義資料: "academic lecture slide, calm colors, highly legible large text, simple diagrams",
    ダーク: "dark background with vivid accent colors, high contrast, sleek tech presentation style",
  };

  let cfg = {
    available: true, qualities: ["auto", "low", "medium", "high", "xhigh", "max"], aspect_ratios: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"],
    long_edges: [1024, 1536, 2560, 3840], backgrounds: ["auto", "opaque", "transparent"], output_formats: ["png", "jpeg", "webp"],
    max_input_images: 16, max_slides: 80,
  };
  const opt = { quality: "medium", aspect: "1:1", edge: 1536, format: "png", slideFormat: "jpeg", bg: "auto", n: 1 };

  // ---------- 設定 ----------
  const tab = () => document.querySelector('input[name="tab"]:checked').value;
  const modelKey = () => document.querySelector('input[name="model"]:checked').value;
  const layoutKey = () => document.querySelector('input[name="layout"]:checked').value;
  const plannerKey = () => document.querySelector('input[name="planner"]:checked').value;

  function renderChips(container, values, current, onPick, label = (v) => v) {
    container.innerHTML = "";
    values.forEach((v) => {
      const c = document.createElement("span");
      c.className = "chip" + (v === current ? " on" : "");
      c.textContent = label(v);
      c.addEventListener("click", () => { onPick(v); renderSettings(); });
      container.appendChild(c);
    });
  }
  function renderSettings() {
    const isGen = tab() === "gen";
    document.querySelectorAll(".only-gen").forEach((el) => (el.hidden = !isGen));
    $("pane-gen").hidden = !isGen;
    $("pane-pptx").hidden = isGen;
    const info = MODEL_INFO[modelKey()];
    $("model-hint").textContent = `${info.label} — ${info.desc}`;
    renderChips($("quality-chips"), cfg.qualities, opt.quality, (v) => (opt.quality = v), (v) => QUALITY_LABEL[v] || v);
    renderChips($("aspect-chips"), cfg.aspect_ratios, opt.aspect, (v) => (opt.aspect = v), (v) => (v === "auto" ? "自動" : v));
    renderChips($("edge-chips"), cfg.long_edges, opt.edge, (v) => (opt.edge = v), (v) => EDGE_LABEL[v] || v);
    $("edge-hint").textContent = opt.edge > 2560 ? "4K は実験的です。時間と費用が大きくなります。" : (isGen && opt.aspect === "auto" ? "アスペクト比「自動」ではモデルがサイズを決めます。" : "");
    const fmtKey = isGen ? "format" : "slideFormat";
    renderChips($("format-chips"), cfg.output_formats, opt[fmtKey], (v) => (opt[fmtKey] = v), (v) => v.toUpperCase());
    renderChips($("bg-chips"), cfg.backgrounds, opt.bg, (v) => (opt.bg = v), (v) => BG_LABEL[v] || v);
    renderChips($("n-chips"), [1, 2, 3, 4], opt.n, (v) => (opt.n = v), (v) => `${v}枚`);
    $("upload-hint").textContent = inputs.length ? `${inputs.length}枚添付中` : `最大${cfg.max_input_images}枚まで`;
    renderCostHint();
  }
  document.querySelectorAll('input[name="model"], input[name="tab"]').forEach((r) => r.addEventListener("change", renderSettings));

  async function loadConfig() {
    try { cfg = { ...cfg, ...(await UI.api("/api/gpt-image/models", { method: "GET" })) }; }
    catch (e) { console.warn("config fallback", e); }
    $("not-configured").hidden = cfg.available;
    $("send").disabled = !cfg.available;
    renderSettings();
  }

  function addFiles(list, files, max) {
    return (async () => {
      const room = max - list.length;
      if (files.length > room) UI.toast(`添付は最大${max}枚までです`, "warn");
      for (const f of files.slice(0, Math.max(0, room))) list.push(await UI.shrinkImage(f));
    })();
  }
  function renderThumbs(container, list, onChange) {
    container.innerHTML = "";
    list.forEach((img, i) => {
      const t = document.createElement("div");
      t.className = "thumb";
      t.innerHTML = `<img src="${img.previewUrl}" alt="input ${i + 1}" /><button class="rm" title="削除">×</button>`;
      t.querySelector(".rm").addEventListener("click", () => { list.splice(i, 1); onChange(); });
      container.appendChild(t);
    });
  }
  function zoom(url) {
    const im = document.createElement("img");
    im.src = url; im.style.maxWidth = "100%"; im.style.maxHeight = "85vh"; im.style.display = "block"; im.style.margin = "0 auto";
    UI.modal(im);
  }

  // =====================================================================
  // タブ1: 画像生成
  // =====================================================================
  const thread = $("thread"), promptEl = $("prompt"), sendBtn = $("send");
  let inputs = [];

  function renderInputs() { renderThumbs($("input-thumbs"), inputs, renderInputs); renderSettings(); }
  $("image-upload").addEventListener("change", async (e) => {
    await addFiles(inputs, Array.from(e.target.files || []), cfg.max_input_images);
    renderInputs();
    e.target.value = null;
  });
  document.addEventListener("paste", async (e) => {
    if (tab() !== "gen") return;
    const items = Array.from(e.clipboardData?.items || []).filter((it) => it.type.startsWith("image/"));
    if (!items.length) return;
    await addFiles(inputs, items.map((it) => it.getAsFile()), cfg.max_input_images);
    renderInputs();
    UI.toast("画像を添付しました", "success", 1800);
  });
  promptEl.addEventListener("dragover", (e) => e.preventDefault());
  promptEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    await addFiles(inputs, Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/")), cfg.max_input_images);
    renderInputs();
  });

  function addTurn(cls) {
    const t = document.createElement("div");
    t.className = `turn ${cls}`;
    thread.appendChild(t);
    thread.parentElement.scrollIntoView({ behavior: "smooth", block: "end" });
    return t;
  }
  function addUser(text, imgs) {
    const t = addTurn("user");
    let html = "";
    if (imgs.length) html += `<div class="thumbs">${imgs.map((i) => `<img src="${i.previewUrl}" />`).join("")}</div>`;
    if (text) html += `<div class="bubble">${UI.escapeHtml(text)}</div>`;
    t.innerHTML = html;
  }

  function renderResult(turn, data, promptText, sent) {
    turn.innerHTML = `<div class="results"></div>`;
    const grid = turn.querySelector(".results");
    data.results.forEach((img, idx) => {
      const blob = UI.dataURLToBlob(img.content, img.mime_type);
      const url = URL.createObjectURL(blob);
      const box = document.createElement("div");
      box.innerHTML = `
        <div class="result-media"><img src="${url}" alt="generated ${idx + 1}" /></div>
        <div class="meta">
          <span class="badge">${UI.escapeHtml(MODEL_INFO[sent.model]?.label || data.model)}</span>
          <span class="badge">${UI.escapeHtml(data.size)} / ${QUALITY_LABEL[sent.quality] || sent.quality}</span>
        </div>
        <div class="result-actions">
          <button class="btn btn-secondary btn-sm" data-act="attach">✏️ この画像を編集</button>
          <button class="btn btn-secondary btn-sm" data-act="video">🎬 動画にする</button>
          <button class="btn btn-secondary btn-sm" data-act="dl">⬇️ ダウンロード</button>
        </div>`;
      box.querySelector("img").addEventListener("click", () => zoom(url));
      box.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "attach") {
          inputs.push({ mime_type: blob.type, data: img.content.split(",")[1], previewUrl: url });
          renderInputs();
          promptEl.placeholder = "例: 背景を夕焼けにして、看板の文字を赤くする";
          promptEl.focus();
        }
        if (act === "video") History.sendTo("video", { blob, mime: blob.type, prompt: promptText });
        if (act === "dl") UI.download(blob, `gpt_image_${UI.stamp()}_${idx + 1}.${UI.extFromMime(blob.type)}`);
      });
      grid.appendChild(box);
      History.add({ type: "image", blob, mime: blob.type, prompt: promptText,
        meta: { provider: "openai", model: data.model, size: data.size, quality: sent.quality, prompt_used: data.prompt_used } });
    });
    if (data.prompt_used && data.prompt_used !== promptText) {
      const d = document.createElement("details");
      d.innerHTML = `<summary>送信したプロンプト</summary><pre>${UI.escapeHtml(data.prompt_used)}</pre>`;
      turn.appendChild(d);
    }
  }

  async function generate() {
    const text = promptEl.value.trim();
    if (!text) { UI.toast("プロンプトを入力してください", "warn"); return; }
    const sentInputs = inputs.slice();
    const options = {
      model: modelKey(), quality: opt.quality, aspect_ratio: opt.aspect, long_edge: opt.edge,
      output_format: opt.format, background: opt.bg, n: opt.n, enhance_prompt: $("opt-enhance").checked,
    };
    addUser(text, sentInputs);
    const turn = addTurn("assistant gen-image");
    turn.innerHTML = `<div class="skeleton" style="width:100%;aspect-ratio:1;max-width:480px"></div><div class="hint">生成中…（品質が高いほど時間がかかります）</div>`;
    UI.setLoading(sendBtn, true);
    try {
      const data = await UI.api("/api/gpt-image/generate", {
        body: { prompt: text, images_data: sentInputs.map((i) => ({ mime_type: i.mime_type, data: i.data })), options },
      });
      renderResult(turn, data, text, options);
      promptEl.value = "";
      inputs = [];
      renderInputs();
    } catch (e) {
      turn.className = "turn assistant error";
      turn.innerHTML = `<div class="bubble">⚠️ ${UI.escapeHtml(e.message)}</div><div class="result-actions"><button class="btn btn-secondary btn-sm" data-retry>もう一度送信</button></div>`;
      turn.querySelector("[data-retry]").addEventListener("click", () => { turn.remove(); generate(); });
      if (e.type === "quota_exceeded") UI.quotaPopup(e.message);
    } finally {
      UI.setLoading(sendBtn, false);
    }
  }
  sendBtn.addEventListener("click", generate);
  promptEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); generate(); }
  });

  // =====================================================================
  // タブ2: PPTX スライド再作成
  // =====================================================================
  const CONCURRENCY = 2;
  let deck = null;          // {filename, slide_width, slide_height, aspect, slides:[...]}
  let refs = [];            // ユーザー指定のスタイル参考画像
  let anchor = null;        // デザイン統一用: 最初に作ったスライド {index, mime_type, data}
  let runCtl = null;        // AbortController

  let stylePreset = null;
  function renderStyleChips() {
    renderChips($("style-chips"), Object.keys(STYLE_PRESETS), stylePreset, (v) => {
      stylePreset = stylePreset === v ? null : v;
      renderStyleChips();
    });
  }
  function styleText() {
    return [stylePreset && STYLE_PRESETS[stylePreset], $("style").value.trim()].filter(Boolean).join(". ");
  }

  function renderRefs() { renderThumbs($("ref-thumbs"), refs, renderRefs); }
  $("ref-upload").addEventListener("change", async (e) => {
    await addFiles(refs, Array.from(e.target.files || []), 4);
    renderRefs();
    e.target.value = null;
  });

  // --- 読み込み ---
  const drop = $("pptx-drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("drag")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) loadDeck(f); });
  $("pptx-upload").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) loadDeck(f); e.target.value = null; });

  async function loadDeck(file) {
    if (!/\.pptx$/i.test(file.name)) { UI.toast("PPTX ファイルを選択してください（.ppt は未対応）", "warn"); return; }
    if (runCtl) { UI.toast("再作成の実行中は読み込めません", "warn"); return; }
    $("parse-progress").hidden = false;
    $("pptx-drop-text").textContent = `「${file.name}」を読み込み中…（スライドを画像化しています）`;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const d = await UI.api("/api/gpt-image/pptx/parse", { body: fd });
      deck = { ...d, filename: file.name };
      deck.slides.forEach((s) => {
        s.selected = !s.hidden && !!s.image;
        s.instruction = "";
        s.concept = "";                    // 演出プラン（AI 提案・編集可）
        s.use_original = !!s.has_visual;   // 元スライドの写真・グラフを素材として渡す
        s.status = "idle";   // idle | running | done | error
        s.result = null;     // {blob, url, mime_type, data, prompt}
        s.origUrl = s.image ? `data:image/jpeg;base64,${s.image}` : null;
      });
      anchor = null;
      $("design-system").value = "";
      $("design-field").hidden = true;
      $("pptx-drop-text").textContent = `「${file.name}」（${deck.slides.length}枚）— 別のファイルをドロップすると置き換えます`;
      if (!d.rendered) UI.toast("一部スライドの画像化に失敗しました。そのスライドは再作成できません。", "warn", 7000);
      renderDeck();
    } catch (e) {
      $("pptx-drop-text").textContent = "PPTX ファイルをここにドロップ、またはクリックして選択";
      UI.handleError(e, "PPTX の読み込みに失敗しました");
    } finally {
      $("parse-progress").hidden = true;
    }
  }

  // --- 一覧描画 ---
  function renderDeck() {
    $("deck-settings").hidden = !deck;
    $("deck-card").hidden = !deck;
    if (!deck) return;
    const list = $("slides");
    list.style.setProperty("--slide-ar", `${deck.slide_width} / ${deck.slide_height}`);
    list.innerHTML = "";
    deck.slides.forEach((s) => list.appendChild(slideRow(s)));
    updateDeckMeta();
  }

  function slideRow(s) {
    const row = document.createElement("div");
    row.className = "slide-row" + (s.selected ? "" : " off");
    row.dataset.index = s.index;
    const textPreview = [
      s.title && `【${s.title}】`,
      ...(s.texts || []).filter((t) => t !== s.title),
      ...(s.tables || []).map((rows) => rows.map((r) => r.join(" | ")).join("\n")),
    ].filter(Boolean).join("\n");
    row.innerHTML = `
      <div class="num"><span>${s.index}</span><input type="checkbox" ${s.selected ? "checked" : ""} ${s.image ? "" : "disabled"} title="再作成の対象" /></div>
      <figure><figcaption>元スライド${s.hidden ? "（非表示）" : ""}</figcaption>
        <div class="frame">${s.origUrl ? `<img src="${s.origUrl}" alt="slide ${s.index}" />` : "画像化できませんでした"}</div></figure>
      <figure class="after"><figcaption>再作成</figcaption><div class="frame" data-out></div></figure>
      <div class="detail">
        <input type="text" data-instruction placeholder="このスライドへの要望（任意）例: 学生が話し合っている場面にしたい" value="${UI.escapeHtml(s.instruction)}" />
        <textarea data-concept rows="3" placeholder="演出プラン（「① 演出プランを作成」で AI が提案します。直接書いても OK）">${UI.escapeHtml(s.concept)}</textarea>
        <label class="check"><input type="checkbox" data-original ${s.use_original ? "checked" : ""} /><span>元スライドの写真・グラフを素材として使う${s.has_visual ? "" : "（図なし）"}</span></label>
        <details><summary>抽出したテキスト${s.notes ? "・ノート" : ""}</summary><pre>${UI.escapeHtml(textPreview || "(テキストなし)")}${s.notes ? `\n\n— ノート —\n${UI.escapeHtml(s.notes)}` : ""}</pre></details>
        <div class="result-actions" data-actions></div>
      </div>`;
    row.querySelector(".num input").addEventListener("change", (e) => {
      s.selected = e.target.checked;
      row.classList.toggle("off", !s.selected);
      updateDeckMeta();
    });
    row.querySelector("[data-instruction]").addEventListener("input", (e) => (s.instruction = e.target.value));
    row.querySelector("[data-concept]").addEventListener("input", (e) => (s.concept = e.target.value));
    row.querySelector("[data-original]").addEventListener("change", (e) => (s.use_original = e.target.checked));
    row.querySelector("figure:first-of-type img")?.addEventListener("click", () => zoom(s.origUrl));
    paintSlide(s, row);
    return row;
  }

  function rowOf(s) { return $("slides").querySelector(`.slide-row[data-index="${s.index}"]`); }

  function paintSlide(s, row = rowOf(s)) {
    if (!row) return;
    const out = row.querySelector("[data-out]");
    const actions = row.querySelector("[data-actions]");
    out.className = "frame";
    actions.innerHTML = "";
    if (s.status === "running") {
      out.classList.add("skeleton");
      out.textContent = "生成中…";
    } else if (s.status === "error") {
      out.classList.add("error");
      out.textContent = `⚠️ ${s.error}`;
    } else if (s.result) {
      out.innerHTML = `<img src="${s.result.url}" alt="recreated ${s.index}" />`;
      out.querySelector("img").addEventListener("click", () => zoom(s.result.url));
    } else {
      out.textContent = s.selected ? "未作成" : "対象外";
    }
    if (s.image && s.status !== "running") {
      const regen = document.createElement("button");
      regen.className = "btn btn-secondary btn-sm";
      regen.textContent = s.result || s.status === "error" ? "🔁 再生成" : "▶ このスライドだけ作成";
      regen.disabled = !cfg.available || !!runCtl;
      regen.addEventListener("click", () => runSlides([s]));
      actions.appendChild(regen);
    }
    if (s.result) {
      const dl = document.createElement("button");
      dl.className = "btn btn-secondary btn-sm";
      dl.textContent = "⬇️ 画像";
      dl.addEventListener("click", () => UI.download(s.result.blob, slideFilename(s)));
      actions.appendChild(dl);
      if (s.result.prompt) {
        const d = document.createElement("details");
        d.innerHTML = `<summary>送信したプロンプト</summary><pre>${UI.escapeHtml(s.result.prompt)}</pre>`;
        actions.appendChild(d);
      }
    }
  }

  function slideFilename(s) {
    const base = (deck.filename || "slides").replace(/\.pptx$/i, "");
    return `${base}_slide${String(s.index).padStart(2, "0")}.${UI.extFromMime(s.result.mime_type)}`;
  }

  function updateDeckMeta() {
    if (!deck) return;
    const sel = deck.slides.filter((s) => s.selected).length;
    const done = deck.slides.filter((s) => s.result).length;
    $("deck-title").textContent = `スライド ${deck.slides.length}枚（選択 ${sel} / 作成済み ${done}）`;
    $("run").disabled = !cfg.available || !sel || !!runCtl;
    $("plan").disabled = (plannerKey() === "gpt" && !cfg.available) || !sel || !!runCtl;
    $("dl-images").disabled = !done;
    renderCostHint();
  }

  function renderCostHint() {
    const el = $("cost-hint");
    if (!el || !deck) return;
    const sel = deck.slides.filter((s) => s.selected).length;
    const heavy = modelKey() === "sunburst" || ["high", "xhigh", "max"].includes(opt.quality) || opt.edge > 1536;
    el.textContent = `${sel}枚 × ${MODEL_INFO[modelKey()].label} / 品質「${QUALITY_LABEL[opt.quality]}」/ 長辺 ${opt.edge}px で生成します。` +
      (heavy ? " 高品質・高解像度の設定は1枚あたりの時間と API 費用が大きくなります。まず数枚で試すのがおすすめです。" : "");
  }

  $("select-all").addEventListener("click", () => { if (!deck) return; deck.slides.forEach((s) => (s.selected = !!s.image)); renderDeck(); });
  $("select-none").addEventListener("click", () => { if (!deck) return; deck.slides.forEach((s) => (s.selected = false)); renderDeck(); });

  // --- ① 演出プラン ---
  const slidePayload = (s) => ({
    index: s.index, title: s.title, texts: s.texts, tables: s.tables, notes: s.notes, has_visual: s.has_visual,
    instruction: s.instruction, image: s.image,
  });

  /** targets の演出プランを作る。keepDesign なら既存のデッキ共通デザインを固定して使う */
  async function planDeck(targets, { keepDesign = false } = {}) {
    const btn = $("plan");
    UI.setLoading(btn, true);
    $("plan-hint").textContent = `${targets.length}枚分の見せ方を検討しています（スライド数により30秒〜数分）…`;
    try {
      const d = await UI.api("/api/gpt-image/pptx/plan", {
        body: {
          slides: targets.map(slidePayload),
          options: {
            filename: deck.filename, total: deck.slides.length, aspect: deck.aspect, style: styleText(), layout: layoutKey(), planner: plannerKey(),
            design_system: keepDesign ? $("design-system").value.trim() : undefined,
          },
        },
      });
      if (!keepDesign) {
        $("design-system").value = d.design_system || "";
        anchor = null;  // デザインが変わったので見本もリセット
      }
      $("design-field").hidden = false;
      const byIndex = new Map((d.slides || []).map((p) => [p.index, p.concept]));
      deck.slides.forEach((s) => { if (byIndex.has(s.index)) s.concept = byIndex.get(s.index); });
      deck.slides.forEach((s) => {
        const ta = rowOf(s)?.querySelector("[data-concept]");
        if (ta) ta.value = s.concept;
      });
      $("plan-hint").textContent = `演出プランを作成しました（${d.model || ""}）。内容を確認・編集してから②で生成してください。`;
      return true;
    } catch (e) {
      $("plan-hint").textContent = "演出プランを作成できませんでした。";
      UI.handleError(e, "演出プランの作成に失敗しました");
      return false;
    } finally {
      UI.setLoading(btn, false);
      updateDeckMeta();
    }
  }
  $("plan").addEventListener("click", () => {
    if (!deck) return;
    const targets = deck.slides.filter((s) => s.selected && s.image);
    if (deck.slides.some((s) => s.result) && !confirm("デッキ共通のデザインも作り直します。作成済みのスライドとは雰囲気が変わる場合があります。続けますか？")) return;
    planDeck(targets);
  });

  $("planner").addEventListener("change", updateDeckMeta);

  /** 生成前に、プランの無いスライドだけ補う（デッキ共通デザインがあれば固定） */
  async function ensurePlans(targets) {
    const missing = targets.filter((s) => !s.concept.trim());
    if (!missing.length && $("design-system").value.trim()) return true;
    return planDeck(missing.length ? missing : targets, { keepDesign: !!$("design-system").value.trim() });
  }

  // --- ② 生成 ---
  function slideOptions() {
    return {
      model: modelKey(), quality: opt.quality, long_edge: opt.edge, output_format: opt.slideFormat,
      aspect: deck.aspect, total: deck.slides.length,
    };
  }

  async function recreate(s, options, signal) {
    s.status = "running";
    s.error = null;
    paintSlide(s);
    const styleRefs = refs.map((r) => ({ mime_type: r.mime_type, data: r.data, role: "user" }));
    if (anchor && anchor.index !== s.index) styleRefs.unshift({ mime_type: anchor.mime_type, data: anchor.data, role: "anchor" });
    try {
      const d = await UI.api("/api/gpt-image/slide", {
        body: {
          slide: { ...slidePayload(s), use_original: s.use_original },
          plan: { design_system: $("design-system").value, concept: s.concept },
          style_refs: styleRefs,
          options,
        },
        signal,
      });
      if (s.result) URL.revokeObjectURL(s.result.url);
      const blob = UI.dataURLToBlob(d.image, d.mime_type);
      s.result = { blob, url: URL.createObjectURL(blob), mime_type: d.mime_type, data: d.image.split(",")[1], prompt: d.prompt_used };
      s.status = "done";
      if ($("opt-consistent").checked && (!anchor || anchor.index === s.index)) {
        anchor = { index: s.index, mime_type: d.mime_type, data: s.result.data };
      }
      History.add({ type: "image", blob, mime: blob.type, prompt: `${deck.filename} スライド${s.index}`,
        meta: { provider: "openai", model: d.model, size: d.size, quality: options.quality, source: "pptx", prompt_used: d.prompt_used } });
    } catch (e) {
      if (e.name === "AbortError") { s.status = "idle"; }
      else {
        s.status = "error";
        s.error = e.message;
        if (e.type === "quota_exceeded") throw e;  // 上限到達時は全体を止める
      }
    } finally {
      paintSlide(s);
      updateDeckMeta();
    }
  }

  async function runSlides(targets) {
    if (!deck || runCtl || !targets.length) return;
    runCtl = new AbortController();
    updateDeckMeta();
    if (!(await ensurePlans(targets))) { runCtl = null; updateDeckMeta(); return; }
    if (!$("opt-consistent").checked) anchor = null;
    const { signal } = runCtl;
    const options = slideOptions();
    let finished = 0;
    const progress = () => {
      $("run-bar").style.width = `${Math.round((finished / targets.length) * 100)}%`;
      $("run-text").textContent = signal.aborted ? `中断しました（${finished}/${targets.length}）`
        : finished === targets.length ? `完了しました（${targets.length}枚）` : `${finished}/${targets.length} 枚完了…`;
    };
    $("run-status").hidden = false;
    $("stop").hidden = false;
    UI.setLoading($("run"), true);
    deck.slides.forEach((s) => paintSlide(s));  // 個別ボタンを無効化
    progress();

    const queue = targets.slice();
    try {
      // デザイン統一: 基準スライドが無ければ先に1枚作ってから残りを並列で
      if ($("opt-consistent").checked && !anchor) {
        await recreate(queue.shift(), options, signal);
        finished++; progress();
      }
      const worker = async () => {
        while (queue.length && !signal.aborted) {
          await recreate(queue.shift(), options, signal);
          finished++; progress();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } catch (e) {
      runCtl.abort();
      UI.handleError(e);
    } finally {
      progress();
      runCtl = null;
      $("stop").hidden = true;
      UI.setLoading($("run"), false);
      deck.slides.forEach((s) => paintSlide(s));
      updateDeckMeta();
      const failed = targets.filter((s) => s.status === "error").length;
      if (failed) UI.toast(`${failed}枚の生成に失敗しました。各スライドの「再生成」で再試行できます。`, "warn", 7000);
      else if (!signal.aborted) UI.toast("スライドの再作成が完了しました", "success");
    }
  }

  $("run").addEventListener("click", () => {
    if (!deck) return;
    runSlides(deck.slides.filter((s) => s.selected && s.image));
  });
  $("stop").addEventListener("click", () => runCtl?.abort());

  // --- ダウンロード ---
  $("dl-images").addEventListener("click", async () => {
    const done = deck.slides.filter((s) => s.result);
    for (const s of done) {
      UI.download(s.result.blob, slideFilename(s));
      await new Promise((r) => setTimeout(r, 350));  // ブラウザの連続DLブロック回避
    }
  });

  $("dl-pptx").addEventListener("click", async () => {
    const btn = $("dl-pptx");
    UI.setLoading(btn, true);
    try {
      const fd = new FormData();
      fd.append("meta", JSON.stringify({
        filename: deck.filename, slide_width: deck.slide_width, slide_height: deck.slide_height,
        slides: deck.slides.map((s) => ({ notes: s.notes })),
      }));
      deck.slides.forEach((s, i) => {
        const blob = s.result ? s.result.blob : s.image ? UI.base64ToBlob(s.image, "image/jpeg") : null;
        if (blob) fd.append(`image_${i}`, blob, `slide_${i + 1}.${UI.extFromMime(blob.type)}`);
      });
      if (deck.slides.some((s) => !s.result && !s.image)) {
        UI.toast("画像化できなかったスライドがあるため PPTX を作成できません", "error");
        return;
      }
      const blob = await UI.api("/api/gpt-image/pptx/build", { body: fd, raw: true });
      UI.download(blob, `${deck.filename.replace(/\.pptx$/i, "")}_gpt.pptx`);
    } catch (e) {
      UI.handleError(e, "PPTX の作成に失敗しました");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (runCtl || (deck && deck.slides.some((s) => s.result))) { e.preventDefault(); e.returnValue = ""; }
  });

  renderStyleChips();
  loadConfig();
})();
