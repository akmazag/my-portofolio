/**
 * CacheEngine.gs
 * Booster Cache: cache bertingkat berbasis VERSI DATA.
 * @version 2.0.0
 *
 * Konsep:
 *  - Setiap modul data punya nomor versi (ScriptProperties: dv_<modul>).
 *  - Cache key memuat versi modul yang menjadi sumbernya + role/scope/filter.
 *  - Saat data berubah, cukup bumpVersion_('modul') → semua key lama otomatis
 *    tidak terpakai lagi (kedaluwarsa sendiri sesuai TTL). Tidak ada registry
 *    key yang harus ditulis ke ScriptProperties pada setiap cache set (v1 lama
 *    melakukan itu dan berisiko race condition + kuota properties).
 *  - Nilai > 90KB dipecah otomatis menjadi beberapa chunk (batas CacheService 100KB).
 *
 * Matriks invalidasi (PRD §6.1):
 *   master   : KODE, OP, INTERVAL  → scope, cleaning, visit, dashboard
 *   users    : USERS               → scope, sesi
 *   cleaning : TRANSAKSI_CLEANING  → cleaning, dashboard
 *   visit    : LOG_VISIT           → visit, dashboard, grading
 *   checklist: CHECKLIST_*         → checklist, grading, dashboard
 *   mastercheck: MASTER_CHECK      → checklist form
 *   config   : APP_CONFIG          → semua kalkulasi
 */

const _CHUNK_SIZE = 90000;
const DATA_MODULES = ['master', 'users', 'cleaning', 'visit', 'checklist', 'mastercheck', 'config'];

function _getCache() { return CacheService.getScriptCache(); }

// ─── Versi Data ───────────────────────────────────────────────────────────────

var _VERSIONS = null;

function _loadVersions_() {
  if (_VERSIONS) return _VERSIONS;
  let all = {};
  try { all = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) {}
  _VERSIONS = {};
  DATA_MODULES.forEach(m => { _VERSIONS[m] = all['dv_' + m] || '0'; });
  return _VERSIONS;
}

/** Versi gabungan modul-modul tertentu, mis. dataVersion_('master','cleaning'). */
function dataVersion_() {
  const v = _loadVersions_();
  return Array.prototype.slice.call(arguments).map(m => v[m] || '0').join('.');
}

/** Tandai data modul berubah → seluruh cache terkait menjadi usang. */
function bumpVersion_() {
  const mods = Array.prototype.slice.call(arguments);
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const props = {};
  mods.forEach(m => { props['dv_' + m] = stamp; });
  try { PropertiesService.getScriptProperties().setProperties(props); } catch (e) {
    Logger.log('[bumpVersion_] gagal: %s', e.message);
  }
  _VERSIONS = null;
}

// ─── Core Cache Operations (dengan chunking) ──────────────────────────────────

function cacheGet_(key) {
  try {
    const cache = _getCache();
    const raw = cache.get(key);
    if (raw === null || raw === undefined) return null;
    if (raw.indexOf('__chunks__:') === 0) {
      const n = Number(raw.split(':')[1]);
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(key + '__' + i);
      const parts = cache.getAll(keys);
      let str = '';
      for (let i = 0; i < n; i++) {
        const p = parts[key + '__' + i];
        if (p === undefined || p === null) return null;
        str += p;
      }
      return JSON.parse(str);
    }
    return JSON.parse(raw);
  } catch (e) {
    Logger.log('[cacheGet_] key "%s": %s', key, e.message);
    return null;
  }
}

function cacheSet_(key, value, ttl) {
  try {
    const safeTtl = Math.min(Math.max(Number(ttl) || 300, 1), 21600);
    const str = JSON.stringify(value);
    const cache = _getCache();
    if (str.length <= _CHUNK_SIZE) { cache.put(key, str, safeTtl); return; }
    const n = Math.ceil(str.length / _CHUNK_SIZE);
    if (n > 40) { Logger.log('[cacheSet_] "%s" terlalu besar (%d chars), skip.', key, str.length); return; }
    const batch = {};
    for (let i = 0; i < n; i++) batch[key + '__' + i] = str.substr(i * _CHUNK_SIZE, _CHUNK_SIZE);
    cache.putAll(batch, safeTtl);
    cache.put(key, '__chunks__:' + n, safeTtl);
  } catch (e) {
    Logger.log('[cacheSet_] key "%s": %s', key, e.message);
  }
}

function cacheDel_(key) {
  try { _getCache().remove(key); } catch (e) {}
}

/** Ambil dari cache atau bangun dengan builder(), lalu simpan. */
function cached_(key, ttl, builder) {
  const hit = cacheGet_(key);
  if (hit !== null) return hit;
  const val = builder();
  cacheSet_(key, val, ttl);
  return val;
}

// ─── Master Data Cache ────────────────────────────────────────────────────────

/**
 * Master data ringkas (KODE, OP, INTERVAL). Hanya field yang dibutuhkan aplikasi.
 * @returns {{kode: Array, op: Array, interval: Array}}
 */
function getMasterCache_() {
  if (_EXEC.master) return _EXEC.master;
  const key = CACHE_KEY_MASTER + '_' + dataVersion_('master');
  _EXEC.master = cached_(key, CACHE_TTL_MASTER, function () {
    const kode = readColumns_('KODE', ['KodeOutlet', 'NamaOutlet', 'LOB', 'Class', 'Area', 'AM', 'Kota', 'RM', 'KabagQCArea', 'StatusOutlet'])
      .map(r => { const o = Object.assign({}, r); o.KodeOutlet = String(o.KodeOutlet).trim(); o.NamaOutlet = String(o.NamaOutlet).trim(); return o; })
      .filter(r => r.KodeOutlet || r.NamaOutlet);
    let op = [];
    try { op = readColumns_('OP', ['NAMA', 'OUTLET', 'JABATAN', 'AREA', 'REGIO', 'DIVISI']); } catch (e) {}
    let interval = [];
    try { interval = readColumns_('INTERVAL', ['Class', 'BulanCuciKursi', 'BulanCuciKarpet', 'STUDIO']); } catch (e) {}
    return { kode: kode, op: op, interval: interval };
  });
  return _EXEC.master;
}

/** Indeks outlet: norm(kode)/norm(nama) → row KODE (semua outlet). */
function getOutletIndex_() {
  if (_EXEC.outletIdx) return _EXEC.outletIdx;
  const idx = {};
  getMasterCache_().kode.forEach(r => {
    if (r.KodeOutlet) idx['k:' + norm_(r.KodeOutlet)] = r;
    if (r.NamaOutlet && !idx['n:' + norm_(r.NamaOutlet)]) idx['n:' + norm_(r.NamaOutlet)] = r;
  });
  _EXEC.outletIdx = idx;
  return idx;
}

/** Cari outlet master berdasarkan kode lalu nama. */
function findOutlet_(kodeOrNama, nama) {
  const idx = getOutletIndex_();
  const a = norm_(kodeOrNama), b = norm_(nama);
  return idx['k:' + a] || (b && idx['k:' + b]) || idx['n:' + a] || (b && idx['n:' + b]) || null;
}

function invalidateMasterCache_() { bumpVersion_('master'); }

// ─── Kompatibilitas API lama ──────────────────────────────────────────────────
function invalidateUserScopeCache_(username) { bumpVersion_('users'); }
function invalidateDashboardCache_(username) { /* versi modul sudah di-bump oleh service */ }
function invalidateAllDashboardCache_() { bumpVersion_('master'); }

/** Hapus seluruh cache aplikasi (menu admin). */
function clearAppCache() {
  bumpVersion_.apply(null, DATA_MODULES);
  try { SpreadsheetApp.getUi().alert('✅ Cache aplikasi telah direset.'); } catch (e) {}
  return true;
}
