/**
 * CINEMA HUB — Audit trail & error log.
 * Tidak pernah melempar error (logging tidak boleh menggagalkan transaksi utama).
 * Nilai sensitif (password, token, hash, NIK, telepon) disensor sebelum ditulis.
 */
const Audit = (() => {
  const SENSITIVE = /pass(word)?|token|hash|salt|secret|pepper|nik|phone/i;

  function redact(value, depth) {
    if (value === null || value === undefined) return value;
    if ((depth || 0) > 4) return '[…]';
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, (depth || 0) + 1));
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach((k) => {
        out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(value[k], (depth || 0) + 1);
      });
      return out;
    }
    if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…';
    return value;
  }

  function log(ctx, entry) {
    try {
      const e = entry || {};
      const action = e.action || (ctx && ctx.action) || '';
      const user = (ctx && ctx.user) || {};
      Repo.table('AUDIT_LOGS').append({
        timestamp: Utils.nowIso(),
        user_id: user.user_id || e.userId || '',
        username: user.username || e.username || '',
        role_id: user.role_id || '',
        action,
        module: e.module || String(action).split('.')[0],
        entity_type: e.entityType || '',
        entity_id: e.entityId || '',
        result: e.result || 'SUCCESS',
        detail_json: e.detail ? redact(e.detail) : null,
        session_ref: ctx && ctx.session && ctx.session.session_id ? String(ctx.session.session_id).slice(-6) : ''
      });
    } catch (err) {
      console.error('Audit log gagal: ' + (err && err.message));
    }
  }

  function error(ctx, err, context) {
    let errorId = 'ERR-UNLOGGED';
    try {
      errorId = Utils.newId('ERR');
      Repo.table('ERROR_LOGS').append({
        error_id: errorId,
        timestamp: Utils.nowIso(),
        user_id: ctx && ctx.user ? ctx.user.user_id : '',
        action: ctx ? ctx.action || '' : '',
        error_code: (err && err.code) || 'INTERNAL_ERROR',
        message: String((err && err.message) || err).slice(0, 1000),
        stack: String((err && err.stack) || '').slice(0, 4000),
        context_json: context ? redact(context) : null
      });
    } catch (e) {
      console.error('Error log gagal: ' + (e && e.message) + ' | asal: ' + (err && err.message));
    }
    console.error('[' + errorId + '] ' + ((err && err.stack) || err));
    return errorId;
  }

  return { log, error, redact };
})();
