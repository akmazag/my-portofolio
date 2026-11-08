/**
 * SheetRepository.gs
 * Data Access Layer: seluruh baca/tulis Google Sheets melalui file ini.
 * @version 2.0.0
 *
 * Optimasi:
 *  - Memo per-eksekusi (_EXEC): satu sheet hanya dibaca sekali per request.
 *  - Selective fetching (readColumns_): hanya kolom yang dibutuhkan yang dibaca,
 *    dikelompokkan per blok kolom yang berdekatan untuk meminimalkan panggilan API.
 *  - Header mapping dinamis + alias (tidak bergantung nomor kolom).
 *  - Penulisan mengikuti header aktual; kolom baru hanya ditambahkan di kanan.
 */

// ─── Memo per-eksekusi (otomatis reset setiap request Apps Script) ────────────
var _EXEC = { ss: null, sheets: {}, tables: {}, cols: {}, headers: {} };

function _execInvalidate_(sheetName) {
  const k = _sheetKey_(sheetName);
  delete _EXEC.tables[k];
  delete _EXEC.headers[k];
  Object.keys(_EXEC.cols).forEach(ck => { if (ck.indexOf(k + '|') === 0) delete _EXEC.cols[ck]; });
}

function _sheetKey_(name) { return compact_(name); }

// ─── Spreadsheet Access ───────────────────────────────────────────────────────

/**
 * Spreadsheet database. ID disimpan di Script Properties 'SPREADSHEET_ID'.
 * Fallback ke spreadsheet aktif (bound script).
 */
function getSS_() {
  if (_EXEC.ss) return _EXEC.ss;
  const props = PropertiesService.getScriptProperties();
  const ssId  = props.getProperty('SPREADSHEET_ID') || props.getProperty('DB_ID');
  if (ssId) {
    try { _EXEC.ss = SpreadsheetApp.openById(ssId); return _EXEC.ss; } catch (e) {
      Logger.log('[getSS_] SPREADSHEET_ID tidak dapat dibuka: %s', e.message);
    }
  }
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) {
    props.setProperty('SPREADSHEET_ID', ss.getId());
    _EXEC.ss = ss;
    return ss;
  }
  throw new Error('Database spreadsheet belum diatur. Jalankan setupDatabase() terlebih dahulu.');
}

/**
 * Cari sheet secara toleran (case-insensitive, abaikan spasi/underscore).
 * Prioritas: nama persis → case-insensitive → compact ("MASTER_CHECK" ~ "MASTER CHECK").
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function findSheet_(name) {
  const key = _sheetKey_(name);
  if (_EXEC.sheets[key]) return _EXEC.sheets[key];
  const ss = getSS_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    const all = ss.getSheets();
    const lower = String(name).trim().toLowerCase();
    sheet = all.find(s => s.getName().trim().toLowerCase() === lower) ||
            all.find(s => compact_(s.getName()) === key) || null;
  }
  if (sheet) _EXEC.sheets[key] = sheet;
  return sheet;
}

/** Seperti findSheet_, tetapi throw NOT_FOUND bila tidak ada. */
function getSheet_(name) {
  const sheet = findSheet_(name);
  if (!sheet) throw new Error('NOT_FOUND: Sheet "' + name + '" tidak ditemukan di spreadsheet.');
  return sheet;
}

/** Ambil sheet persis berdasarkan nama (tanpa toleransi) — dipakai untuk sheet legacy. */
function getSheetExact_(name) {
  try { return getSS_().getSheetByName(name); } catch (e) { return null; }
}

// ─── Header Mapping ───────────────────────────────────────────────────────────

/** Nama kunci schema untuk sheet ('Users' → 'USERS'). */
function _schemaKey_(sheetName) {
  const k = String(sheetName).toUpperCase().replace(/\s+/g, '_');
  return SCHEMA[k] ? k : (SCHEMA[sheetName] ? sheetName : null);
}

/**
 * Peta compact(header aktual) → nama kolom kanonik schema (termasuk alias).
 * @returns {Object}
 */
function _canonMap_(sheetName) {
  const sk = _schemaKey_(sheetName);
  const map = {};
  if (!sk) return map;
  SCHEMA[sk].forEach(k => { map[compact_(k)] = k; });
  const al = HEADER_ALIASES[sk] || {};
  Object.keys(al).forEach(canon => al[canon].forEach(a => {
    if (!(compact_(a) in map)) map[compact_(a)] = canon;
  }));
  return map;
}

/** Header aktual (baris 1) sebuah sheet, memo per eksekusi. */
function readHeaders_(sheetName) {
  const k = _sheetKey_(sheetName);
  if (_EXEC.headers[k]) return _EXEC.headers[k];
  const sheet = getSheet_(sheetName);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol < 1 ? [] : sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  _EXEC.headers[k] = headers;
  return headers;
}

/**
 * Indeks kolom (0-based) untuk nama field kanonik / alias. -1 bila tidak ada.
 */
function colIndex_(sheetName, field) {
  const headers = readHeaders_(sheetName);
  const canon = _canonMap_(sheetName);
  const target = compact_(field);
  // 1. Persis (compact)
  let idx = headers.findIndex(h => compact_(h) === target);
  if (idx >= 0) return idx;
  // 2. Via alias: header yang dipetakan ke field kanonik yang sama
  const canonField = canon[target] || field;
  idx = headers.findIndex(h => canon[compact_(h)] === canonField);
  return idx;
}

// ─── Read Operations ──────────────────────────────────────────────────────────

/** Konversi nilai sel ke nilai JSON-friendly. */
function _cellOut_(val) {
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const hms = Utilities.formatDate(val, TZ, 'HH:mm:ss');
    return hms === '00:00:00' ? fmtDate_(val) : fmtDateTime_(val);
  }
  return (val === undefined || val === null) ? '' : val;
}

/**
 * Baca seluruh tabel sebagai array of objects (header aktual + nama kanonik).
 * Hasil di-memo per eksekusi. Baris kosong dilewati. __rowIndex = nomor baris (1-based).
 */
function readTable_(sheetName) {
  const k = _sheetKey_(sheetName);
  if (_EXEC.tables[k]) return _EXEC.tables[k];

  const sheet   = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) { _EXEC.tables[k] = []; return []; }

  const values  = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  _EXEC.headers[k] = headers;
  const canon   = _canonMap_(sheetName);
  const result  = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(cell => cell === '' || cell === null || cell === undefined)) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const out = _cellOut_(row[c]);
      if (!(key in obj) || obj[key] === '') obj[key] = out;
      const ck = canon[compact_(key)];
      if (ck && ck !== key && (!(ck in obj) || obj[ck] === '')) obj[ck] = out;
    }
    obj.__rowIndex = r + 1;
    result.push(obj);
  }
  _EXEC.tables[k] = result;
  return result;
}

/**
 * SELECTIVE FETCHING — baca hanya kolom tertentu.
 * Kolom dikelompokkan menjadi blok berdekatan agar jumlah panggilan getRange minimal.
 * Field yang tidak ada di sheet akan bernilai ''.
 *
 * @param {string}   sheetName
 * @param {string[]} fields     - nama field kanonik
 * @param {Object}   [opt]      - {lastN: number} hanya N baris terakhir
 * @returns {Array<Object>}
 */
function readColumns_(sheetName, fields, opt) {
  opt = opt || {};
  const memoKey = _sheetKey_(sheetName) + '|' + fields.join(',') + '|' + (opt.lastN || '');
  if (_EXEC.cols[memoKey]) return _EXEC.cols[memoKey];
  // Jika tabel penuh sudah dibaca di eksekusi ini, gunakan ulang.
  const full = _EXEC.tables[_sheetKey_(sheetName)];
  if (full && !opt.lastN) { _EXEC.cols[memoKey] = full; return full; }

  const sheet   = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const startRow = opt.lastN ? Math.max(2, lastRow - opt.lastN + 1) : 2;
  const nRows    = lastRow - startRow + 1;

  const idxs = fields.map(f => colIndex_(sheetName, f));
  const present = idxs.filter(i => i >= 0).sort((a, b) => a - b);
  const colData = {};
  // Kelompokkan kolom berdekatan (gap ≤ 2 kolom digabung)
  let i = 0;
  while (i < present.length) {
    let j = i;
    while (j + 1 < present.length && present[j + 1] - present[j] <= 3) j++;
    const from = present[i], to = present[j];
    const block = sheet.getRange(startRow, from + 1, nRows, to - from + 1).getValues();
    for (let c = from; c <= to; c++) colData[c] = block.map(r => r[c - from]);
    i = j + 1;
  }

  const out = [];
  for (let r = 0; r < nRows; r++) {
    let empty = true;
    const obj = {};
    fields.forEach((f, fi) => {
      const ci = idxs[fi];
      const v = ci >= 0 ? _cellOut_(colData[ci][r]) : '';
      if (v !== '') empty = false;
      obj[f] = v;
    });
    if (empty) continue;
    obj.__rowIndex = startRow + r;
    out.push(obj);
  }
  _EXEC.cols[memoKey] = out;
  return out;
}

/** Filter baris. */
function findRows_(sheetName, filterFn) {
  return readTable_(sheetName).filter(filterFn);
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/**
 * Header aktual sheet; kolom SCHEMA yang belum ada ditambahkan di kanan.
 * Jika sheet kosong, header SCHEMA dipakai.
 */
function getSheetHeaders_(sheet, schema) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    sheet.getRange(1, 1, 1, schema.length).setValues([schema]);
    return schema.slice();
  }
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const canon = _canonMap_(sheet.getName());
  const have = {};
  headers.forEach(h => {
    have[compact_(h)] = true;
    if (canon[compact_(h)]) have[compact_(canon[compact_(h)])] = true;
  });
  const missing = schema.filter(k => !have[compact_(k)]);
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

/** Peta objek → {compactKey: value}, termasuk pemetaan alias header. */
function _rowFromObj_(sheetName, headers, obj, existing) {
  const lookup = {};
  Object.keys(obj || {}).forEach(k => { const ck = compact_(k); if (!(ck in lookup)) lookup[ck] = obj[k]; });
  const canon = _canonMap_(sheetName);
  return headers.map((h, i) => {
    const ch = compact_(h);
    let key = null;
    if (ch in lookup) key = ch;
    else if (canon[ch] && compact_(canon[ch]) in lookup) key = compact_(canon[ch]);
    if (key !== null) return cellValue_(lookup[key]);
    if (existing) { const ex = existing[i]; return (ex !== undefined && ex !== null) ? ex : ''; }
    return '';
  });
}

/** Cegah formula injection & hilangnya nol di depan. */
function cellValue_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') {
    if (/^0\d+$/.test(v)) return "'" + v;
    if (/^[=+@]/.test(v)) return "'" + v;
  }
  return v;
}

/**
 * Tambah satu baris. Mengikuti header aktual sheet.
 * @returns {number} row index baris baru
 */
function appendRow_(sheetName, obj) {
  return appendRows_(sheetName, [obj]);
}

/**
 * Tambah banyak baris sekaligus (batch write).
 * @returns {number} row index baris terakhir
 */
function appendRows_(sheetName, objs) {
  const sk = _schemaKey_(sheetName);
  const schema = sk ? SCHEMA[sk] : null;
  if (!schema) throw new Error('NOT_FOUND: Schema untuk sheet "' + sheetName + '" tidak ditemukan.');
  if (!objs || !objs.length) return 0;

  const sheet = getSheet_(sheetName);
  const now   = fmtDateTime_(new Date());
  const headers = getSheetHeaders_(sheet, schema);
  const rows = objs.map(obj => {
    if (schema.includes('CreatedAt') && !obj['CreatedAt']) obj['CreatedAt'] = now;
    if (schema.includes('UpdatedAt') && !obj['UpdatedAt']) obj['UpdatedAt'] = now;
    if (schema.includes('Timestamp') && !obj['Timestamp']) obj['Timestamp'] = now;
    return _rowFromObj_(sheetName, headers, obj, null);
  });
  if (rows.length === 1) {
    // appendRow bersifat atomik di sisi Sheets → aman untuk penulisan bersamaan
    sheet.appendRow(rows[0]);
    _execInvalidate_(sheetName);
    return sheet.getLastRow();
  }
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
  _execInvalidate_(sheetName);
  return start + rows.length - 1;
}

/**
 * Update baris berdasarkan row index. Hanya field yang dikirim yang diubah.
 */
function updateRow_(sheetName, rowIndex, obj) {
  const sk = _schemaKey_(sheetName);
  const schema = sk ? SCHEMA[sk] : null;
  if (!schema) throw new Error('NOT_FOUND: Schema untuk sheet "' + sheetName + '" tidak ditemukan.');
  if (!rowIndex || rowIndex < 2) throw new Error('VALIDATION_ERROR: Baris data tidak valid.');

  const sheet = getSheet_(sheetName);
  if (schema.includes('UpdatedAt') && !obj['UpdatedAt']) obj['UpdatedAt'] = fmtDateTime_(new Date());
  const headers  = getSheetHeaders_(sheet, schema);
  const existing = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const merged   = _rowFromObj_(sheetName, headers, obj, existing);
  sheet.getRange(rowIndex, 1, 1, merged.length).setValues([merged]);
  _execInvalidate_(sheetName);
}

/**
 * Tulis satu kolom untuk banyak baris (batch). updates: [{row, value}]
 */
function updateColumn_(sheetName, field, updates) {
  if (!updates || !updates.length) return;
  const sk = _schemaKey_(sheetName);
  const sheet = getSheet_(sheetName);
  getSheetHeaders_(sheet, SCHEMA[sk]);
  _execInvalidate_(sheetName);
  const ci = colIndex_(sheetName, field);
  if (ci < 0) throw new Error('NOT_FOUND: Kolom "' + field + '" tidak ditemukan.');
  const rows = updates.map(u => u.row);
  const minR = Math.min.apply(null, rows), maxR = Math.max.apply(null, rows);
  const range = sheet.getRange(minR, ci + 1, maxR - minR + 1, 1);
  const formulas = range.getFormulas();
  if (formulas.some(f => f[0])) {
    // Ada formula di antara baris → tulis per sel agar formula tidak tertimpa
    updates.forEach(u => sheet.getRange(u.row, ci + 1).setValue(cellValue_(u.value)));
  } else {
    const vals = range.getValues();
    updates.forEach(u => { vals[u.row - minR][0] = cellValue_(u.value); });
    range.setValues(vals);
  }
  _execInvalidate_(sheetName);
}

/** Hapus baris permanen (hanya dipakai untuk data master yang tidak bertransaksi). */
function deleteRow_(sheetName, rowIndex) {
  const sheet = getSheet_(sheetName);
  sheet.deleteRow(rowIndex);
  _execInvalidate_(sheetName);
}

// ─── Utility / Helper Functions ───────────────────────────────────────────────

/** Normalisasi padat: huruf kecil tanpa spasi/simbol ("Nama Outlet" == "NamaOutlet"). */
function compact_(s) {
  return String(s === undefined || s === null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalisasi string: lowercase + trim + spasi tunggal. */
function norm_(s) {
  return String(s === undefined || s === null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Pembulatan angka ke n desimal. */
function round_(n, d) {
  const num = Number(n);
  if (!isFinite(num)) return 0;
  const f = Math.pow(10, d === undefined ? 1 : d);
  return Math.round(num * f) / f;
}

function fmtDate_(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function fmtDateTime_(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** Tanggal hari ini (string yyyy-MM-dd, zona Asia/Jakarta). */
function todayStr_() { return fmtDate_(new Date()); }

/**
 * Parse string/Date/serial menjadi Date (tengah hari lokal untuk string tanggal murni,
 * agar tidak bergeser hari karena timezone).
 */
function toDate_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); // dd/MM/yyyy
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Selisih hari kalender (b - a) berdasarkan string yyyy-MM-dd. */
function dayDiff_(aStr, bStr) {
  const a = toDate_(aStr), b = toDate_(bStr);
  if (!a || !b) return null;
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

/**
 * Tambah bulan dengan penanganan akhir bulan (31 Jan + 1 bln = 28/29 Feb, bukan 3 Mar).
 */
function addMonths_(d, n) {
  const src = new Date(d);
  const day = src.getDate();
  const res = new Date(src.getFullYear(), src.getMonth() + Number(n), 1, 12, 0, 0);
  const last = new Date(res.getFullYear(), res.getMonth() + 1, 0).getDate();
  res.setDate(Math.min(day, last));
  return res;
}

/** Tambah bulan pada format 'yyyy-MM'. */
function addYm_(ym, n) {
  const y = Number(String(ym).slice(0, 4)), m = Number(String(ym).slice(5, 7)) - 1 + Number(n);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return yy + '-' + String(mm + 1).padStart(2, '0');
}

/** Angka positif murni; Date/teks/NaN → null (validasi data master). */
function toPositiveNumber_(v) {
  if (v === '' || v === null || v === undefined || v instanceof Date) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const n = Number(String(v).replace(',', '.'));
  return (isFinite(n) && n > 0) ? n : null;
}

function uuid_() { return Utilities.getUuid(); }

/** SHA-256 hex. */
function sha256_(s) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return raw.map(b => { const h = (b < 0 ? b + 256 : b).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}

/** Escape HTML (dipakai pada pesan yang mungkin dirender sebagai HTML). */
function escHtml_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Nilai boolean toleran (TRUE, 1, ya, aktif). */
function isTrue_(v) {
  if (v === true || v === 1) return true;
  return ['true', '1', 'ya', 'yes', 'y', 'aktif', 'active'].includes(norm_(v));
}
