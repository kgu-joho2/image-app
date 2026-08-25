/* ブラウザ内（IndexedDB）に生成物を保存する履歴 + ページ間の受け渡し(Handoff)
   サーバーには保存しない。 */
window.History = (function () {
  const DB = "gemini-studio", VER = 1, STORE = "items", HANDOFF = "handoff";
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("IndexedDB unavailable"));
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("type", "type");
          s.createIndex("created", "created");
        }
        if (!db.objectStoreNames.contains(HANDOFF)) db.createObjectStore(HANDOFF, { keyPath: "kind" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /** item: {type:'image'|'video'|'audio'|'music', blob, mime, prompt, meta:{}} */
  async function add(item) {
    try {
      const rec = { id: uid(), created: Date.now(), ...item };
      if (rec.type === "image" && !rec.thumb) rec.thumb = await makeThumb(rec.blob).catch(() => null);
      await tx(STORE, "readwrite", (s) => s.put(rec));
      return rec.id;
    } catch (e) { console.warn("History.add failed", e); return null; }
  }
  async function list({ type } = {}) {
    try {
      const all = await tx(STORE, "readonly", (s) => {
        const req = s.getAll();
        return req;
      });
      const rows = (all || []).filter((r) => !type || r.type === type);
      rows.sort((a, b) => b.created - a.created);
      return rows;
    } catch (e) { console.warn("History.list failed", e); return []; }
  }
  async function get(id) {
    try { return await tx(STORE, "readonly", (s) => s.get(id)); } catch { return null; }
  }
  async function remove(id) {
    try { await tx(STORE, "readwrite", (s) => s.delete(id)); return true; } catch { return false; }
  }
  async function clear() {
    try { await tx(STORE, "readwrite", (s) => s.clear()); return true; } catch { return false; }
  }
  async function count() { return (await list()).length; }

  async function makeThumb(blob, size = 320) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
  }

  // ---------- Handoff: 別ページへ blob / prompt を渡す ----------
  async function handoffSet(kind, payload) {
    try { await tx(HANDOFF, "readwrite", (s) => s.put({ kind, created: Date.now(), ...payload })); return true; }
    catch (e) { console.warn("handoff failed", e); return false; }
  }
  async function handoffTake(kind) {
    try {
      const v = await tx(HANDOFF, "readonly", (s) => s.get(kind));
      if (v) await tx(HANDOFF, "readwrite", (s) => s.delete(kind));
      return v || null;
    } catch { return null; }
  }
  /** 便利関数: 画像 blob を kind('video'|'music'|'image') のページに渡して遷移 */
  async function sendTo(kind, payload) {
    const ok = await handoffSet(kind, payload);
    if (!ok) { window.UI?.toast("受け渡しに失敗しました", "error"); return; }
    location.href = `/${kind}/`;
  }

  return { add, list, get, remove, clear, count, handoffSet, handoffTake, sendTo };
})();
