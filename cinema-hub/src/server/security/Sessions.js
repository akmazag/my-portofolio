/**
 * CINEMA HUB — Manajemen sesi.
 *
 * - Token 256-bit dikirim SEKALI ke klien; server hanya menyimpan SHA-256(token).
 * - Expiry idle (sliding) + absolut. Sesi "Ingat saya" memakai umur SESSION_REMEMBER_DAYS.
 * - Cache sesi 10 menit untuk menghemat pembacaan sheet; revoke langsung menghapus cache.
 * (Dinamai "Sessions" agar tidak menimpa global bawaan Apps Script "Session".)
 */
const Sessions = (() => {
  const TOKEN_RE = /^[a-f0-9]{64}$/;
  const FIELDS = ['session_id', 'token_hash', 'user_id', 'created_at', 'last_seen_at', 'idle_expires_at',
    'absolute_expires_at', 'remember', 'status'];

  function table() { return Repo.table('SESSIONS'); }

  function durations(remember) {
    if (remember) {
      const ms = Config.get('SESSION_REMEMBER_DAYS', 7) * 86400000;
      return { idle: ms, absolute: ms };
    }
    return {
      idle: Config.get('SESSION_IDLE_MINUTES', 60) * 60000,
      absolute: Config.get('SESSION_ABSOLUTE_HOURS', 12) * 3600000
    };
  }

  function cacheKey(hash) { return 'sess:' + hash; }

  function cachePut(s) {
    Cache.putJson(cacheKey(s.token_hash), Utils.pick(s, FIELDS), CH.SESSION_CACHE_SEC);
  }

  function create(user, opts) {
    const options = opts || {};
    const token = Utils.randomToken();
    const hash = Utils.sha256Hex(token);
    const now = Date.now();
    const d = durations(!!options.remember);
    const record = table().insert({
      token_hash: hash,
      user_id: user.user_id,
      created_at: Utils.isoFromMs(now),
      last_seen_at: Utils.isoFromMs(now),
      idle_expires_at: Utils.isoFromMs(now + d.idle),
      absolute_expires_at: Utils.isoFromMs(now + d.absolute),
      remember: !!options.remember,
      user_agent: Sanitize.line(options.userAgent || '', 200),
      status: 'ACTIVE'
    }, null);
    enforceMax(user.user_id, record.session_id);
    cachePut(record);
    return { token, session: Utils.pick(record, FIELDS) };
  }

  function enforceMax(userId, keepId) {
    const max = Config.get('MAX_SESSIONS_PER_USER', 5);
    const nowMs = Date.now();
    const active = table().all()
      .filter((s) => s.user_id === userId && s.status === 'ACTIVE' && Utils.toMs(s.absolute_expires_at) > nowMs)
      .sort((a, b) => Utils.toMs(b.created_at) - Utils.toMs(a.created_at));
    const excess = active.slice(max).filter((s) => s.session_id !== keepId);
    if (!excess.length) return;
    const ids = {};
    excess.forEach((s) => { ids[s.session_id] = true; Cache.remove(cacheKey(s.token_hash)); });
    table().updateWhere((s) => ids[s.session_id] === true, () => ({
      status: 'REVOKED', revoked_at: Utils.nowIso(), revoked_reason: 'MAX_SESSIONS'
    }), null);
  }

  function load(hash) {
    const cached = Cache.getJson(cacheKey(hash));
    if (cached) return cached;
    const row = table().findFresh('token_hash', hash);
    return row ? Utils.pick(row, FIELDS) : null;
  }

  function verify(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw Errors.create('UNAUTHENTICATED');
    const hash = Utils.sha256Hex(token);
    const s = load(hash);
    if (!s) throw Errors.create('UNAUTHENTICATED');
    if (s.status !== 'ACTIVE') throw Errors.create('SESSION_EXPIRED');

    const now = Date.now();
    if (now > Utils.toMs(s.idle_expires_at) || now > Utils.toMs(s.absolute_expires_at)) {
      close(s, 'EXPIRED', 'TIMEOUT');
      throw Errors.create('SESSION_EXPIRED');
    }

    const user = Repo.table('USERS').findById(s.user_id);
    if (!user || user.status !== 'ACTIVE') {
      close(s, 'REVOKED', 'USER_INACTIVE');
      throw Errors.create('SESSION_EXPIRED', 'Akun Anda tidak aktif. Hubungi administrator.');
    }

    if (now - Utils.toMs(s.last_seen_at) > CH.SESSION_TOUCH_SEC * 1000) {
      const d = durations(s.remember === true);
      const idleExp = Math.min(now + d.idle, Utils.toMs(s.absolute_expires_at));
      s.last_seen_at = Utils.isoFromMs(now);
      s.idle_expires_at = Utils.isoFromMs(idleExp);
      try {
        table().update(s.session_id, { last_seen_at: s.last_seen_at, idle_expires_at: s.idle_expires_at }, null);
      } catch (e) {
        console.warn('Gagal memperbarui sesi: ' + e.message); // non-fatal
      }
      cachePut(s);
    }
    return { session: s, user };
  }

  function close(s, status, reason) {
    Cache.remove(cacheKey(s.token_hash));
    try {
      table().update(s.session_id, { status, revoked_at: Utils.nowIso(), revoked_reason: reason }, null);
    } catch (e) {
      console.warn('Gagal menutup sesi: ' + e.message);
    }
  }

  function revoke(session, reason) {
    close(session, 'REVOKED', reason || 'LOGOUT');
  }

  /** Mencabut semua sesi aktif user (kecuali exceptSessionId). */
  function revokeAllForUser(userId, reason, exceptSessionId) {
    const rows = table().all().filter((s) => s.user_id === userId && s.status === 'ACTIVE' && s.session_id !== exceptSessionId);
    rows.forEach((s) => Cache.remove(cacheKey(s.token_hash)));
    if (!rows.length) return 0;
    const ids = {};
    rows.forEach((s) => { ids[s.session_id] = true; });
    return table().updateWhere((s) => ids[s.session_id] === true, () => ({
      status: 'REVOKED', revoked_at: Utils.nowIso(), revoked_reason: reason || 'ADMIN'
    }), null);
  }

  /** Dipanggil job harian: tandai sesi kedaluwarsa. */
  function expireStale() {
    const now = Date.now();
    return table().updateWhere(
      (s) => s.status === 'ACTIVE' && (now > Utils.toMs(s.idle_expires_at) || now > Utils.toMs(s.absolute_expires_at)),
      (s) => { Cache.remove(cacheKey(s.token_hash)); return { status: 'EXPIRED', revoked_at: Utils.nowIso(), revoked_reason: 'TIMEOUT' }; },
      null
    );
  }

  return { create, verify, revoke, revokeAllForUser, expireStale, durations };
})();
