/* 動画生成ページ — /api/video/jobs (Veo 3.1, ジョブID方式) */
(function () {
  const $ = (id) => document.getElementById(id);
  const promptEl = $("prompt"), genBtn = $("generate"), progressCard = $("progress-card"), progressText = $("progress-text"),
    resultCard = $("result-card"), resultVideo = $("result-video");

  const MAX_REFS = 3;
  let first = null, last = null, refs = [];
  let lastJob = null;     // {job_id, blob, prompt}
  let polling = null, aborted = false;

  // ---------- モード ----------
  function mode() { return document.querySelector('input[name="mode"]:checked').value; }
  function renderMode() {
    const m = mode();
    document.querySelectorAll(".mode-panel").forEach((p) => p.classList.toggle("on", p.dataset.mode === m));
    $("prompt-label").textContent = { text: "プロンプト", frames: "画像に基づく動きの指示", refs: "参照画像を使ったシーンの指示", extend: "続きの内容" }[m];
    const disableAR = m === "extend";
    document.querySelectorAll('input[name="aspect"]').forEach((r) => (r.disabled = disableAR));
    $("opt-resolution").disabled = disableAR;
  }
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", renderMode));

  // ---------- 画像入力 ----------
  function bindDrop(zoneId, fileId, onFiles) {
    const zone = $(zoneId), input = $(fileId);
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drag"); onFiles(Array.from(e.dataTransfer.files || [])); });
    input.addEventListener("change", (e) => { onFiles(Array.from(e.target.files || [])); e.target.value = null; });
  }
  function thumb(container, img, onRemove, tag) {
    container.innerHTML = "";
    if (!img) return;
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img src="${img.previewUrl}" />${tag ? `<span class="tag">${tag}</span>` : ""}<button class="rm">×</button>`;
    t.querySelector(".rm").addEventListener("click", onRemove);
    container.appendChild(t);
  }
  function renderRefs() {
    const c = $("thumb-refs");
    c.innerHTML = "";
    refs.forEach((img, i) => {
      const t = document.createElement("div");
      t.className = "thumb";
      t.innerHTML = `<img src="${img.previewUrl}" /><span class="tag">${i + 1}</span><button class="rm">×</button>`;
      t.querySelector(".rm").addEventListener("click", () => { refs.splice(i, 1); renderRefs(); });
      c.appendChild(t);
    });
  }
  bindDrop("drop-first", "file-first", async (fs) => { if (fs[0]) { first = await UI.shrinkImage(fs[0]); thumb($("thumb-first"), first, () => { first = null; thumb($("thumb-first"), null); }, "最初"); } });
  bindDrop("drop-last", "file-last", async (fs) => { if (fs[0]) { last = await UI.shrinkImage(fs[0]); thumb($("thumb-last"), last, () => { last = null; thumb($("thumb-last"), null); }, "最後"); } });
  bindDrop("drop-refs", "file-refs", async (fs) => {
    const room = MAX_REFS - refs.length;
    if (fs.length > room) UI.toast(`参照画像は最大${MAX_REFS}枚までです`, "warn");
    for (const f of fs.slice(0, Math.max(0, room))) refs.push(await UI.shrinkImage(f));
    renderRefs();
  });

  // ---------- 生成 ----------
  function opts() {
    return {
      model: document.querySelector('input[name="model"]:checked').value,
      duration_seconds: Number($("opt-duration").value),
      resolution: $("opt-resolution").value,
      aspect_ratio: document.querySelector('input[name="aspect"]:checked').value,
      negative_prompt: $("opt-negative").value.trim(),
      enhance_prompt: $("opt-enhance").checked,
    };
  }
  const strip = (i) => (i ? { mime_type: i.mime_type, data: i.data } : null);

  async function generate() {
    const prompt = promptEl.value.trim();
    const m = mode();
    if (!prompt) return UI.toast("プロンプトを入力してください", "warn");
    if (m === "frames" && !first) return UI.toast("最初のフレーム画像を選択してください", "warn");
    if (m === "refs" && !refs.length) return UI.toast("参照画像を1枚以上選択してください", "warn");
    if (m === "extend" && !lastJob) return UI.toast("延長元の動画がありません", "warn");

    const body = { prompt, options: opts() };
    if (m === "frames") { body.first_frame = strip(first); if (last) body.last_frame = strip(last); }
    if (m === "refs") body.reference_images = refs.map(strip);
    if (m === "extend") body.extend_job_id = lastJob.job_id;

    aborted = false;
    UI.setLoading(genBtn, true);
    resultCard.style.display = "none";
    progressCard.style.display = "block";
    progressText.textContent = "リクエストを送信しています…";
    const started = Date.now();
    try {
      const job = await UI.api("/api/video/jobs", { body });
      progressText.textContent = "生成中… 通常1〜3分かかります（1080p/4Kはさらに長くなります）";
      const result = await poll(job.job_id, started);
      if (aborted) return;
      showResult(result, prompt, job.job_id);
    } catch (e) {
      if (!aborted) UI.handleError(e, "動画生成に失敗しました");
    } finally {
      UI.setLoading(genBtn, false);
      progressCard.style.display = "none";
    }
  }
  function poll(jobId, started) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        if (aborted) return resolve(null);
        try {
          const d = await UI.api(`/api/video/jobs/${jobId}`, { method: "GET" });
          if (d.status === "done") return resolve(d);
          const s = Math.floor((Date.now() - started) / 1000);
          progressText.textContent = `生成中… 経過 ${UI.fmtTime(s)}（通常1〜3分。4K・1080pは長めです）`;
          polling = setTimeout(tick, 8000);
        } catch (e) { reject(e); }
      };
      polling = setTimeout(tick, 6000);
    });
  }
  $("cancel").addEventListener("click", () => {
    aborted = true;
    clearTimeout(polling);
    UI.setLoading(genBtn, false);
    progressCard.style.display = "none";
    UI.toast("待機を中止しました（サーバー側の生成は継続します）", "warn");
  });

  function showResult(d, prompt, jobId) {
    const item = d.results.find((r) => r.type === "video");
    if (!item) throw new Error("動画が返りませんでした");
    const blob = UI.dataURLToBlob(item.content, "video/mp4");
    if (resultVideo.src) URL.revokeObjectURL(resultVideo.src);
    resultVideo.src = URL.createObjectURL(blob);
    const o = opts();
    $("result-meta").innerHTML = `<span class="badge">${UI.escapeHtml(d.model)}</span><span class="badge">${o.duration_seconds}秒 / ${mode() === "extend" ? "720p" : o.resolution} / ${o.aspect_ratio}</span><span class="badge">${UI.fmtTime(d.elapsed || 0)}</span>`;
    $("result-prompt").textContent = d.prompt_used || prompt;
    resultCard.style.display = "block";
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    lastJob = { job_id: jobId, blob, prompt };
    $("mode-extend").disabled = false;
    const te = $("thumb-extend");
    te.innerHTML = `<div class="thumb"><video src="${resultVideo.src}" muted></video></div>`;
    History.add({ type: "video", blob, mime: blob.type, prompt, meta: { model: d.model, ...o, prompt_used: d.prompt_used } });
  }

  $("act-download").addEventListener("click", () => lastJob && UI.download(lastJob.blob, `video_${UI.stamp()}.mp4`));
  $("act-extend").addEventListener("click", () => {
    $("mode-extend").checked = true; renderMode();
    promptEl.value = ""; promptEl.placeholder = "例: その後カメラが引いて、街全体が見渡せるようになる"; promptEl.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("act-new").addEventListener("click", () => {
    resultCard.style.display = "none";
    promptEl.value = ""; first = last = null; refs = [];
    thumb($("thumb-first"), null); thumb($("thumb-last"), null); renderRefs();
    document.querySelector('input[name="mode"][value="text"]').checked = true; renderMode();
  });
  genBtn.addEventListener("click", generate);
  promptEl.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); generate(); } });

  // 画像ページ / ギャラリーからの受け渡し → 最初のフレームに
  (async () => {
    const h = await History.handoffTake("video");
    if (!h || !h.blob) return;
    const dataUrl = await UI.blobToDataURL(h.blob);
    first = { mime_type: h.mime || h.blob.type, data: dataUrl.split(",")[1], previewUrl: dataUrl };
    thumb($("thumb-first"), first, () => { first = null; thumb($("thumb-first"), null); }, "最初");
    document.querySelector('input[name="mode"][value="frames"]').checked = true;
    renderMode();
    if (h.prompt) promptEl.placeholder = `例: 「${h.prompt.slice(0, 40)}」の画像が動き出す…`;
    UI.toast("画像を最初のフレームとして読み込みました", "success");
  })();
  renderMode();
})();
