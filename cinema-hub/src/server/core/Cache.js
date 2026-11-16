/**
 * CINEMA HUB — Cache berversi di atas CacheService.
 *
 * - Nilai > CHUNK karakter dipecah ke beberapa key (batas CacheService 100 KB per nilai).
 * - Versi per tabel: menaikkan versi = invalidasi seluruh cache tabel tersebut dalam O(1).
 * - Semua kegagalan cache bersifat non-fatal (fallback ke sumber data).
 */
const Cache = (() => {
  const CHUNK = 30000; // karakter; aman walau UTF-8 multi-byte
  const MAX_CHUNKS = 80;

  function store() { return CacheService.getScriptCache(); }

  function getJson(key) {
    try {
      const head = store().get(key);
      if (!head) return null;
      if (head.indexOf('J:') === 0) return JSON.parse(head.slice(2));
      if (head.indexOf('C:') === 0) {
        const n = parseInt(head.slice(2), 10);
        const keys = [];
        for (let i = 0; i < n; i++) keys.push(key + '#' + i);
        const parts = store().getAll(keys);
        let s = '';
        for (let i = 0; i < n; i++) {
          const part = parts[keys[i]];
          if (part === undefined || part === null) return null;
          s += part;
        }
        return JSON.parse(s);
      }
      return null;
    } catch (e) {
      console.warn('Cache.getJson gagal (' + key + '): ' + e.message);
      return null;
    }
  }

  function putJson(key, value, ttlSec) {
    const ttl = Math.min(ttlSec || CH.CACHE_TTL_SEC, CH.CACHE_TTL_SEC);
    try {
      const s = JSON.stringify(value);
      if (s.length <= CHUNK) {
        store().put(key, 'J:' + s, ttl);
        return true;
      }
      const n = Math.ceil(s.length / CHUNK);
      if (n > MAX_CHUNKS) return false; // terlalu besar untuk di-cache; baca langsung dari sheet
      const map = {};
      for (let i = 0; i < n; i++) map[key + '#' + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
      store().putAll(map, ttl);
      store().put(key, 'C:' + n, ttl);
      return true;
    } catch (e) {
      console.warn('Cache.putJson gagal (' + key + '): ' + e.message);
      return false;
    }
  }

  function get(key) {
    try { return store().get(key); } catch (e) { return null; }
  }

  function put(key, value, ttlSec) {
    try { store().put(key, String(value), Math.min(ttlSec || CH.CACHE_TTL_SEC, CH.CACHE_TTL_SEC)); } catch (e) { /* non-fatal */ }
  }

  function remove(key) {
    try { store().remove(key); } catch (e) { /* non-fatal */ }
  }

  function version(name) {
    const k = 'ver:' + name;
    let v = get(k);
    if (!v) {
      v = Date.now().toString(36) + Utils.randomCode(3);
      put(k, v);
    }
    return v;
  }

  function bump(name) {
    put('ver:' + name, Date.now().toString(36) + Utils.randomCode(3));
  }

  return { getJson, putJson, get, put, remove, version, bump };
})();
