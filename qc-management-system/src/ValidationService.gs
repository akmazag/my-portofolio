/**
 * ValidationService.gs
 * Fungsi validasi dan sanitasi input untuk QC Management System
 * Semua fungsi validator throw Error dengan prefix 'VALIDATION_ERROR:' jika gagal
 * @version 2.0.0
 */

// ─── Primitif Validators ──────────────────────────────────────────────────────

/**
 * Validasi field wajib diisi (tidak null, undefined, atau string kosong).
 * @param {*}      value     - Nilai yang divalidasi
 * @param {string} fieldName - Nama field untuk pesan error
 * @throws {Error} VALIDATION_ERROR jika kosong
 */
function required_(value, fieldName) {
  if (value === null || value === undefined) {
    throw new Error('VALIDATION_ERROR: Field "' + fieldName + '" wajib diisi.');
  }
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('VALIDATION_ERROR: Field "' + fieldName + '" tidak boleh kosong.');
  }
}

/**
 * Validasi apakah nilai adalah tanggal yang valid.
 * Menerima string ISO, Date object, atau angka serial Google Sheets.
 * @param {*}      v         - Nilai yang divalidasi
 * @param {string} fieldName - Nama field untuk pesan error
 * @returns {Date} Objek Date yang valid
 * @throws {Error} VALIDATION_ERROR jika bukan tanggal valid
 */
function validDate_(v, fieldName) {
  required_(v, fieldName);
  const d = toDate_(v);
  if (!d || isNaN(d.getTime())) {
    throw new Error('VALIDATION_ERROR: Field "' + fieldName + '" harus berupa tanggal yang valid (format: yyyy-MM-dd).');
  }
  return d;
}

/**
 * Validasi apakah nilai termasuk dalam array nilai yang diizinkan.
 * Perbandingan case-insensitive.
 * @param {*}        v         - Nilai yang divalidasi
 * @param {string[]} allowed   - Array nilai yang diizinkan
 * @param {string}   fieldName - Nama field untuk pesan error
 * @throws {Error} VALIDATION_ERROR jika tidak ada di allowed
 */
function validEnum_(v, allowed, fieldName) {
  required_(v, fieldName);
  const normalizedV       = norm_(String(v));
  const normalizedAllowed = allowed.map(a => norm_(String(a)));
  if (!normalizedAllowed.includes(normalizedV)) {
    throw new Error(
      'VALIDATION_ERROR: Nilai "' + v + '" tidak valid untuk field "' + fieldName +
      '". Nilai yang diizinkan: ' + allowed.join(', ') + '.'
    );
  }
}

/**
 * Validasi score item checklist: harus angka 1–5 (atau 0) atau string 'NA'.
 * @param {*} v - Nilai score
 * @throws {Error} VALIDATION_ERROR jika tidak valid
 * @returns {number|string} Score yang sudah tervalidasi
 */
function validScore_(v) {
  if (v === 'NA' || v === 'na' || v === 'N/A') return 'NA';

  const num = Number(v);
  if (!isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 5) {
    return num;
  }

  throw new Error(
    'VALIDATION_ERROR: Score harus berupa angka 1–5 atau "NA". Nilai yang diberikan: "' + v + '".'
  );
}

/**
 * Validasi angka dalam rentang tertentu.
 * @param {*}      v         - Nilai yang divalidasi
 * @param {number} min       - Nilai minimum (inklusif)
 * @param {number} max       - Nilai maksimum (inklusif)
 * @param {string} fieldName - Nama field untuk pesan error
 * @returns {number}
 * @throws {Error} VALIDATION_ERROR jika di luar rentang
 */
function validRange_(v, min, max, fieldName) {
  const num = Number(v);
  if (isNaN(num)) {
    throw new Error('VALIDATION_ERROR: Field "' + fieldName + '" harus berupa angka.');
  }
  if (num < min || num > max) {
    throw new Error(
      'VALIDATION_ERROR: Field "' + fieldName + '" harus antara ' + min + ' dan ' + max + '.'
    );
  }
  return num;
}

/**
 * Validasi panjang string.
 * @param {*}      v         - Nilai yang divalidasi
 * @param {number} maxLen    - Panjang maksimum karakter
 * @param {string} fieldName - Nama field untuk pesan error
 * @throws {Error} VALIDATION_ERROR jika melebihi panjang maks
 */
function validMaxLen_(v, maxLen, fieldName) {
  const str = String(v || '');
  if (str.length > maxLen) {
    throw new Error(
      'VALIDATION_ERROR: Field "' + fieldName + '" terlalu panjang (maksimum ' + maxLen + ' karakter).'
    );
  }
}

// ─── String Sanitizer ─────────────────────────────────────────────────────────

/**
 * Sanitasi string input: trim dan ganti karakter berbahaya.
 * - Hapus null bytes
 * - Escape karakter formula injection di spreadsheet (=, +, -, @, |, %)
 * - Trim whitespace
 *
 * @param {*} s - Input string
 * @returns {string} String yang sudah disanitasi
 */
function sanitizeStr_(s) {
  if (s === null || s === undefined) return '';
  let str = String(s).trim();

  // Hapus null bytes dan karakter kontrol berbahaya
  str = str.replace(/\0/g, '');
  // eslint-disable-next-line no-control-regex
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Cegah formula injection di spreadsheet
  // Jika string diawali karakter formula, tambahkan prefix apostrophe
  if (/^[=+@]/.test(str) || /^-[^\s\d]/.test(str)) {
    str = "'" + str;
  }
  // Batasi panjang agar tidak membebani sel / cache
  if (str.length > 2000) str = str.substring(0, 2000);

  return str;
}

/**
 * Sanitasi object: sanitasi semua nilai string secara rekursif.
 * @param {Object} obj
 * @returns {Object}
 */
function sanitizeObj_(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (typeof val === 'string') {
      result[key] = sanitizeStr_(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = sanitizeObj_(val);
    } else {
      result[key] = val;
    }
  });
  return result;
}

// ─── File Validator ───────────────────────────────────────────────────────────

/**
 * Validasi file upload: harus PDF dan ukuran tidak melebihi MAX_PDF_BYTES.
 * @param {string} name  - Nama file (harus berekstensi .pdf)
 * @param {number} bytes - Ukuran file dalam bytes
 * @throws {Error} VALIDATION_ERROR jika tidak valid
 */
function validateFile_(name, bytes) {
  required_(name, 'NamaFile');
  required_(bytes, 'UkuranFile');

  const cleanName = sanitizeStr_(name).toLowerCase();
  if (!cleanName.endsWith('.pdf')) {
    throw new Error('VALIDATION_ERROR: Hanya file PDF yang diizinkan. File yang diunggah: "' + name + '".');
  }

  const maxBytes = MAX_PDF_BYTES || (10 * 1024 * 1024);
  if (Number(bytes) > maxBytes) {
    const maxMB = (maxBytes / 1024 / 1024).toFixed(0);
    const fileMB = (Number(bytes) / 1024 / 1024).toFixed(2);
    throw new Error(
      'VALIDATION_ERROR: Ukuran file (' + fileMB + ' MB) melebihi batas maksimum ' + maxMB + ' MB.'
    );
  }
}

// ─── Username / Password Validator ───────────────────────────────────────────

/**
 * Validasi format username: alfanumerik, underscore, titik, 4–50 karakter.
 * @param {string} username
 * @throws {Error} VALIDATION_ERROR jika tidak valid
 */
function validUsername_(username) {
  required_(username, 'Username');
  const str = String(username).trim();
  if (!/^[a-zA-Z0-9._]{4,50}$/.test(str)) {
    throw new Error(
      'VALIDATION_ERROR: Username hanya boleh mengandung huruf, angka, titik, underscore (4–50 karakter).'
    );
  }
}

/**
 * Validasi kekuatan password: minimal 6 karakter.
 * @param {string} password
 * @throws {Error} VALIDATION_ERROR jika terlalu pendek
 */
function validPassword_(password) {
  required_(password, 'Password');
  const len = String(password).length;
  if (len < 6) {
    throw new Error('VALIDATION_ERROR: Password minimal 6 karakter.');
  }
  if (len > 128) {
    throw new Error('VALIDATION_ERROR: Password maksimal 128 karakter.');
  }
}

// ─── Role Validator ───────────────────────────────────────────────────────────

/**
 * Validasi role berdasarkan ROLES enum.
 * @param {string} role
 * @throws {Error} VALIDATION_ERROR jika role tidak valid
 */
function validRole_(role) {
  const allowed = Object.values(ROLES);
  validEnum_(role, allowed, 'Role');
}
