/* 音楽生成ページ — /api/music/generate (Lyria 3) */
(function () {
  const $ = (id) => document.getElementById(id);
  const promptEl = $("prompt"), genBtn = $("generate"), resultCard = $("result-card"), audioEl = $("result-audio");
  const MAX_IMAGES = 10;
  let images = [], lastResult = null;

  // ---------- ビルダー ----------
  const GROUPS = {
    genre: ["Lo-fi hip hop", "J-Pop", "City pop", "Rock", "Jazz", "Bossa nova", "EDM", "House", "Ambient", "Cinematic orchestral", "Acoustic folk", "R&B", "Synthwave", "Chiptune", "Piano ballad"],
    mood: ["chill", "uplifting", "melancholic", "energetic", "dreamy", "epic", "romantic", "dark", "playful", "nostalgic", "calm", "tense"],
    inst: ["piano", "acoustic guitar", "electric guitar", "Rhodes", "synth pad", "strings", "brass", "808 bass", "brushed drums", "flute", "violin", "koto", "shamisen", "taiko"],
  };
  const picked = { genre: new Set(), mood: new Set(), inst: new Set() };
  Object.entries(GROUPS).forEach(([g, items]) => {
    const c = document.querySelector(`.chips[data-group="${g}"]`);
    items.forEach((v) => {
      const s = document.createElement("span");
      s.className = "chip"; s.textContent = v;
      s.addEventListener("click", () => { picked[g].has(v) ? picked[g].delete(v) : picked[g].add(v); s.classList.toggle("on"); });
      c.appendChild(s);
    });
  });
  const bpm = $("bpm"), bpmOn = $("bpm-on"), bpmVal = $("bpm-val");
  const syncBpm = () => (bpmVal.textContent = bpmOn.checked ? `${bpm.value} BPM` : "指定なし");
  bpm.addEventListener("input", () => { bpmOn.checked = true; syncBpm(); });
  bpmOn.addEventListener("change", syncBpm);

  function builderText() {
    const parts = [];
    if (picked.genre.size) parts.push([...picked.genre].join(" / "));
    if (picked.mood.size) parts.push(`mood: ${[...picked.mood].join(", ")}`);
    if (picked.inst.size) parts.push(`instruments: ${[...picked.inst].join(", ")}`);
    if (bpmOn.checked) parts.push(`${bpm.value} BPM`);
    if ($("key").value) parts.push(`key: ${$("key").value}`);
    const v = $("vocal").value;
    if (v) parts.push({ instrumental: "instrumental (no vocals)", female: "female vocals", male: "male vocals", duet: "male and female duet vocals" }[v]);
    return parts.join(", ");
  }
  $("apply-builder").addEventListener("click", () => {
    const t = builderText();
    if (!t) return UI.toast("要素を選択してください", "warn");
    const cur = promptEl.value.trim();
    promptEl.value = cur ? `${cur}\n\n${t}` : t;
    promptEl.focus();
  });
  $("reset-builder").addEventListener("click", () => {
    Object.values(picked).forEach((s) => s.clear());
    document.querySelectorAll(".chips[data-group] .chip").forEach((c) => c.classList.remove("on"));
    bpmOn.checked = false; syncBpm(); $("key").value = ""; $("vocal").value = "";
  });
  $("struct-chips").addEventListener("click", (e) => {
    const ins = e.target.closest("[data-ins]")?.dataset.ins;
    if (!ins) return;
    const s = promptEl.selectionStart ?? promptEl.value.length;
    const before = promptEl.value.slice(0, s), after = promptEl.value.slice(s);
    const nl = before && !before.endsWith("\n") ? "\n" : "";
    promptEl.value = `${before}${nl}${ins}${ins.endsWith(" ") ? "" : "\n"}${after}`;
    promptEl.focus();
    promptEl.selectionStart = promptEl.selectionEnd = (before + nl + ins).length + (ins.endsWith(" ") ? 0 : 1);
  });

  // ---------- モデル ----------
  const modelKey = () => document.querySelector('input[name="model"]:checked').value;
  document.querySelectorAll('input[name="model"]').forEach((r) => r.addEventListener("change", () => {
    const pro = modelKey() === "pro";
    $("opt-wav").disabled = !pro;
    if (!pro) $("opt-wav").checked = false;
  }));

  // ---------- 画像 ----------
  $("image-upload").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    const room = MAX_IMAGES - images.length;
    if (files.length > room) UI.toast(`参照画像は最大${MAX_IMAGES}枚までです`, "warn");
    for (const f of files.slice(0, Math.max(0, room))) images.push(await UI.shrinkImage(f, 1536));
    renderImages(); e.target.value = null;
  });
  function renderImages() {
    const c = $("image-thumbs");
    c.innerHTML = "";
    images.forEach((img, i) => {
      const t = document.createElement("div");
      t.className = "thumb";
      t.innerHTML = `<img src="${img.previewUrl}" /><button class="rm">×</button>`;
      t.querySelector(".rm").addEventListener("click", () => { images.splice(i, 1); renderImages(); });
      c.appendChild(t);
    });
  }

  // ---------- 生成 ----------
  async function generate(forceModel) {
    const prompt = promptEl.value.trim();
    if (!prompt && !images.length) return UI.toast("プロンプトを入力するか参照画像を選択してください", "warn");
    const model = forceModel || modelKey();
    UI.setLoading(genBtn, true);
    try {
      const d = await UI.api("/api/music/generate", {
        body: {
          prompt, images_data: images.map((i) => ({ mime_type: i.mime_type, data: i.data })),
          options: { model, wav: $("opt-wav").checked, enhance_prompt: $("opt-enhance").checked },
        },
      });
      const item = d.results.find((r) => r.type === "audio");
      if (!item) throw new Error("音楽が返りませんでした");
      const blob = UI.dataURLToBlob(item.content, "audio/mpeg");
      if (audioEl.src) URL.revokeObjectURL(audioEl.src);
      audioEl.src = URL.createObjectURL(blob);
      lastResult = { blob, prompt, model };
      const dur = await UI.drawWaveform($("wave"), blob);
      $("result-meta").innerHTML = `<span class="badge">${UI.escapeHtml(d.model)}</span><span class="badge">${UI.extFromMime(blob.type).toUpperCase()}</span>${dur ? `<span class="badge">${UI.fmtTime(dur)}</span>` : ""}`;
      const lyrics = (item.lyrics || "").trim();
      $("result-lyrics").textContent = lyrics;
      $("lyrics-wrap").style.display = lyrics ? "block" : "none";
      $("result-prompt").textContent = d.prompt_used || prompt;
      $("act-pro").style.display = model === "clip" ? "" : "none";
      resultCard.style.display = "block";
      resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
      History.add({ type: "music", blob, mime: blob.type, prompt, meta: { model: d.model, lyrics, prompt_used: d.prompt_used } });
    } catch (e) {
      UI.handleError(e, "音楽生成に失敗しました");
    } finally {
      UI.setLoading(genBtn, false);
    }
  }
  genBtn.addEventListener("click", () => generate());
  promptEl.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); generate(); } });
  $("act-pro").addEventListener("click", () => {
    document.querySelector('input[name="model"][value="pro"]').checked = true;
    $("opt-wav").disabled = false;
    generate("pro");
  });
  $("act-download").addEventListener("click", () => lastResult && UI.download(lastResult.blob, `music_${UI.stamp()}.${UI.extFromMime(lastResult.blob.type)}`));
  $("act-new").addEventListener("click", () => { resultCard.style.display = "none"; promptEl.value = ""; images = []; renderImages(); audioEl.pause(); });

  // 画像ページ / ギャラリーからの受け渡し
  (async () => {
    const h = await History.handoffTake("music");
    if (!h) return;
    if (h.blob) {
      const dataUrl = await UI.blobToDataURL(h.blob);
      images.push({ mime_type: h.mime || h.blob.type, data: dataUrl.split(",")[1], previewUrl: dataUrl });
      renderImages();
      promptEl.value = promptEl.value || "この画像の雰囲気と色合いに合う音楽";
      UI.toast("画像を参照として読み込みました", "success");
    } else if (h.prompt) {
      promptEl.value = h.prompt;
    }
  })();
})();
