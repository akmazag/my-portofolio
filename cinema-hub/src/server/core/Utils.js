/**
 * CINEMA HUB — Utilitas umum.
 *
 * Scope: penyimpanan memo per-eksekusi. Apps Script membuat global baru di setiap eksekusi,
 * namun Gateway tetap memanggil Scope.reset() di awal request agar perilakunya eksplisit
 * (dan konsisten di emulator pengujian).
 */
const Scope = (() => {
  let store = {};
  return {
    get(key, factory) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) store[key] = factory();
      return store[key];
    },
    has(key) { return Object.prototype.hasOwnProperty.call(store, key); },
    set(key, value) { store[key] = value; },
    clear(prefix) {
      Object.keys(store).forEach((k) => { if (k === prefix || k.indexOf(prefix) === 0) delete store[k]; });
    },
    reset() { store = {}; }
  };
})();

const Utils = (() => {
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ISO_PATTERN = "yyyy-MM-dd'T'HH:mm:ssXXX";

  function tz() {
    return Scope.get('tz', () => {
      let value = null;
      try { value = PropertiesService.getScriptProperties().getProperty(CH.PROPS.TIMEZONE); } catch (e) { value = null; }
      return value || Session.getScriptTimeZone() || CH.DEFAULT_TZ;
    });
  }

  function fmt(date, pattern) {
    return Utilities.formatDate(date, tz(), pattern);
  }

  function nowIso() { return fmt(new Date(), ISO_PATTERN); }
  function isoFromMs(ms) { return fmt(new Date(ms), ISO_PATTERN); }
  function today() { return fmt(new Date(), 'yyyy-MM-dd'); }
  function nowTime() { return fmt(new Date(), 'HH:mm'); }

  function toMs(iso) {
    if (!iso) return 0;
    if (iso instanceof Date) return iso.getTime();
    const t = Date.parse(String(iso));
    return isNaN(t) ? 0 : t;
  }

  function isDateStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    const p = s.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  /** Tambah hari pada string tanggal yyyy-MM-dd (aritmetika kalender, bebas zona waktu). */
  function addDays(dateStr, n) {
    const p = String(dateStr).split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(fromStr, toStr) {
    const a = String(fromStr).split('-').map(Number);
    const b = String(toStr).split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }

  function timeToMin(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  function toArray(bytes) {
    return Array.prototype.slice.call(bytes);
  }

  /** Byte acak kriptografis: SHA-256 atas UUID v4 (SecureRandom di Apps Script). */
  function randomBytes(n) {
    let out = [];
    while (out.length < n) {
      out = out.concat(toArray(Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        Utilities.getUuid() + ':' + Utilities.getUuid(),
        Utilities.Charset.UTF_8
      )));
    }
    return out.slice(0, n);
  }

  function bytesToHex(bytes) {
    return toArray(bytes).map((b) => ((b & 0xff) + 0x100).toString(16).slice(1)).join('');
  }

  function randomToken() { return bytesToHex(randomBytes(32)); }

  function randomCode(len) {
    // 256 habis dibagi 32 → distribusi seragam
    return randomBytes(len).map((b) => B32[(b & 0xff) % 32]).join('');
  }

  function newId(prefix) {
    return prefix + '-' + fmt(new Date(), 'yyMMdd') + '-' + randomCode(5);
  }

  function sha256Hex(str) {
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8));
  }

  /** Normalisasi untuk pencarian: lowercase, tanpa diakritik, spasi tunggal. */
  function normalize(s) {
    return String(s === null || s === undefined ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function csv(value) {
    if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
    return String(value === null || value === undefined ? '' : value)
      .split(',').map((x) => x.trim()).filter(Boolean);
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function paginate(items, page, pageSize) {
    const size = Math.max(1, Math.min(100, pageSize || 20));
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const current = Math.max(1, Math.min(pages, page || 1));
    return { items: items.slice((current - 1) * size, current * size), total, page: current, pageSize: size, pages };
  }

  function pick(obj, keys) {
    const out = {};
    keys.forEach((k) => { if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
    return out;
  }

  return {
    tz, fmt, nowIso, isoFromMs, today, nowTime, toMs, isDateStr, addDays, daysBetween, timeToMin,
    randomBytes, randomToken, randomCode, newId, bytesToHex, sha256Hex, toArray,
    normalize, csv, initials, paginate, pick
  };
})();
