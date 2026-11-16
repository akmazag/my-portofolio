/**
 * CINEMA HUB — Sanitasi input & perlindungan formula injection.
 */
const Sanitize = (() => {
  // Karakter kontrol kecuali \t dan \n
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const FORMULA_START = /^[=+\-@\t\r]/;
  const ESCAPED_FORMULA = /^'[=+\-@\t\r]/;

  /** Teks multi-baris: normalisasi newline, buang karakter kontrol, trim, potong. */
  function text(value, max) {
    if (value === null || value === undefined) return '';
    let s = String(value).replace(/\r\n?/g, '\n').replace(CTRL, '').trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }

  /** Teks satu baris. */
  function line(value, max) {
    return text(String(value === null || value === undefined ? '' : value).replace(/\s*\n\s*/g, ' '), max);
  }

  /**
   * Nilai teks yang diawali = + - @ ditulis sebagai teks literal (prefix apostrof),
   * sehingga Google Sheets tidak mengeksekusinya sebagai formula.
   */
  function forSheet(value) {
    if (typeof value === 'string' && FORMULA_START.test(value)) return "'" + value;
    return value;
  }

  function fromSheet(value) {
    if (typeof value === 'string' && ESCAPED_FORMULA.test(value)) return value.slice(1);
    return value;
  }

  /** Untuk ekspor CSV (mencegah CSV injection di Excel). */
  function forCsv(value) {
    const s = String(value === null || value === undefined ? '' : value);
    return FORMULA_START.test(s) ? "'" + s : s;
  }

  function isHttpsUrl(value) {
    return /^https:\/\/[^\s<>"'`]+$/i.test(String(value || '')) && String(value).length <= 2000;
  }

  function isEmail(value) {
    return /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[a-z]{2,}$/i.test(String(value || '')) && String(value).length <= 254;
  }

  return { text, line, forSheet, fromSheet, forCsv, isHttpsUrl, isEmail };
})();
