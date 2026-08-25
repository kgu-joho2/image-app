/* 共通ヘッダー + テーマ切替。各ページの <body> 先頭に挿入する。 */
(function () {
  const LINKS = [
    { href: "/", label: "ホーム", key: "home" },
    { href: "/image/", label: "🖼️ 画像", key: "image" },
    { href: "/video/", label: "🎬 動画", key: "video" },
    { href: "/tts/", label: "🗣️ 音声", key: "tts" },
    { href: "/music/", label: "🎵 音楽", key: "music" },
    { href: "/gallery/", label: "🗂️ ギャラリー", key: "gallery" },
  ];

  const THEME_KEY = "app-theme";
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; }
  }
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
  }
  function effectiveTheme() {
    const t = getTheme();
    if (t !== "system") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  applyTheme(getTheme());

  function currentKey() {
    const p = location.pathname;
    const seg = p.split("/").filter(Boolean)[0];
    if (!seg || seg === "index.html") return "home";
    return seg;
  }

  function render() {
    const header = document.createElement("header");
    header.className = "app-header";
    const key = currentKey();
    header.innerHTML = `
      <div class="inner">
        <a class="brand" href="/">✨ Gemini Studio</a>
        <nav>${LINKS.map((l) => `<a href="${l.href}" class="${l.key === key ? "active" : ""}">${l.label}</a>`).join("")}</nav>
        <button class="theme-toggle" type="button" title="テーマ切替" aria-label="テーマ切替"></button>
      </div>`;
    document.body.prepend(header);
    const btn = header.querySelector(".theme-toggle");
    const sync = () => { btn.textContent = effectiveTheme() === "dark" ? "☀️" : "🌙"; };
    sync();
    btn.addEventListener("click", () => {
      const next = effectiveTheme() === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      applyTheme(next);
      sync();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
