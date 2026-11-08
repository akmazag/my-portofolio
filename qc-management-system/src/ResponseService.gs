/**
 * ResponseService.gs
 * Standar response dan executor terpusat untuk semua endpoint backend.
 * @version 2.0.0
 *
 * Format response: { ok: true, data } | { ok: false, code, msg }
 */

function ok_(data) { return { ok: true, data: data }; }

function err_(msg, code) {
  return { ok: false, code: code || 'ERROR', msg: String(msg || 'Terjadi kesalahan tidak diketahui.') };
}

const _SAFE_ERRORS = {
  SESSION_EXPIRED:  'Sesi Anda telah berakhir. Silakan login kembali.',
  ACCESS_DENIED:    null,   // pesan asli aman ditampilkan
  NOT_FOUND:        null,
  LOCK_TIMEOUT:     'Sistem sedang sibuk, coba beberapa saat lagi.',
  VALIDATION_ERROR: null,
  MAINTENANCE:      'Aplikasi sedang dalam pemeliharaan. Silakan coba beberapa saat lagi.'
};

/** Ubah Error domain menjadi response aman (detail teknis tidak dikirim ke browser). */
function _errorResponse_(e) {
  const msg = String((e && e.message) || '');
  const codes = Object.keys(_SAFE_ERRORS);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (msg.indexOf(c) === 0) {
      const text = _SAFE_ERRORS[c] || msg.replace(new RegExp('^' + c + ':?\\s*'), '') || c;
      return err_(text, c);
    }
  }
  if (/Lock timeout|timed out waiting for lock|lock/i.test(msg) && /lock/i.test(msg)) {
    return err_(_SAFE_ERRORS.LOCK_TIMEOUT, 'LOCK_TIMEOUT');
  }
  return err_('Terjadi kesalahan pada server. Silakan coba lagi atau hubungi administrator.', 'SERVER_ERROR');
}

/**
 * Executor dengan validasi sesi + revokasi (user nonaktif/dihapus langsung keluar).
 * @param {string}   token
 * @param {Function} fn(user)
 */
function run_(token, fn) {
  try {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('SESSION_EXPIRED: Token kosong.');
    }
    const user = validateSession_(token.trim());
    if (getConfigBool_('maintenance_mode', false) && !isAdminRole_(user.role)) {
      throw new Error('MAINTENANCE');
    }
    const result = fn(user);
    if (result && typeof result === 'object' && 'ok' in result && ('data' in result || 'msg' in result)) return result;
    return ok_(result);
  } catch (e) {
    Logger.log('[run_] %s | %s', e && e.message, e && e.stack);
    return _errorResponse_(e);
  }
}

/** Executor tanpa sesi (login). */
function runPublic_(fn) {
  try {
    const result = fn();
    if (result && typeof result === 'object' && 'ok' in result && ('data' in result || 'msg' in result)) return result;
    return ok_(result);
  } catch (e) {
    Logger.log('[runPublic_] %s | %s', e && e.message, e && e.stack);
    const msg = String((e && e.message) || '');
    if (msg.indexOf('VALIDATION_ERROR') === 0) return err_(msg.replace(/^VALIDATION_ERROR:?\s*/, ''), 'VALIDATION_ERROR');
    if (msg.indexOf('MAINTENANCE') === 0) return err_(_SAFE_ERRORS.MAINTENANCE, 'MAINTENANCE');
    return err_('Login gagal. Periksa kembali username dan password Anda.', 'LOGIN_FAILED');
  }
}

/** Jalankan fn di dalam ScriptLock (anti race-condition & double submit). */
function withLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 20000)) throw new Error('LOCK_TIMEOUT');
  try { return fn(); } finally { lock.releaseLock(); }
}

function toJSON_(response) {
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}
