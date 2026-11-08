/**
 * SessionService.gs
 * Sesi login, hashing password bersalt, indeks user untuk revokasi sesi.
 * @version 2.0.0
 */

const _SESSION_PREFIX = 'sess_';

// ─── Password Hashing ─────────────────────────────────────────────────────────

/**
 * Hash password bersalt + iterasi.
 * Format tersimpan: sha256$<iter>$<salt>$<hex>
 */
function hashPassword_(plain, salt, iter) {
  salt = salt || Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  iter = iter || PASSWORD_HASH_ITER;
  let h = sha256_(salt + '|' + String(plain));
  for (let i = 1; i < iter; i++) h = sha256_(h + salt);
  return 'sha256$' + iter + '$' + salt + '$' + h;
}

/** Apakah nilai tersimpan sudah dalam format hash (baru / legacy)? */
function isHashedPassword_(stored) {
  const s = String(stored || '').trim();
  return /^sha256\$\d+\$[^$]+\$[a-f0-9]{64}$/i.test(s) || /^[a-f0-9]{64}$/i.test(s);
}

/** Perbandingan waktu-konstan sederhana. */
function _safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Verifikasi password. Mendukung:
 *  1. sha256$iter$salt$hash (v2)
 *  2. SHA-256 hex tanpa salt (v1)
 *  3. plaintext (data lama) — akan dimigrasikan setelah login berhasil
 * @returns {{valid: boolean, needsRehash: boolean}}
 */
function verifyPassword_(stored, input) {
  const s = String(stored === undefined || stored === null ? '' : stored).trim();
  const p = String(input === undefined || input === null ? '' : input);
  if (!s || !p) return { valid: false, needsRehash: false };
  const m = s.match(/^sha256\$(\d+)\$([^$]+)\$([a-f0-9]{64})$/i);
  if (m) {
    const h = hashPassword_(p, m[2], Number(m[1]));
    return { valid: _safeEq_(h.toLowerCase(), s.toLowerCase()), needsRehash: Number(m[1]) < PASSWORD_HASH_ITER };
  }
  if (/^[a-f0-9]{64}$/i.test(s)) {
    return { valid: _safeEq_(sha256_(p), s.toLowerCase()) || _safeEq_(sha256_(p.trim()), s.toLowerCase()), needsRehash: true };
  }
  return { valid: _safeEq_(s, p) || _safeEq_(s, p.trim()), needsRehash: true };
}

/** Kompatibilitas v1. */
function checkPass_(stored, input) { return verifyPassword_(stored, input).valid; }

// ─── Normalisasi Role ─────────────────────────────────────────────────────────

/** Role kanonik dari teks bebas. null bila tidak dikenal. */
function canonRole_(role) {
  const r = norm_(role);
  if (!r) return null;
  if (ROLE_ALIASES[r]) return ROLE_ALIASES[r];
  if (r.indexOf('specialist') >= 0 || r.indexOf('kabag') >= 0) return ROLES.SPECIALIST;
  if (r.indexOf('qc area') >= 0) return ROLES.QC_AREA;
  return null;
}

// ─── Indeks User (untuk revokasi sesi) ────────────────────────────────────────

/** Ambil nilai kolom password (Password / PasswordHash) yang terisi. */
function _storedPassword_(row) {
  const a = row['Password'], b = row['PasswordHash'];
  if (isHashedPassword_(b)) return String(b);
  if (isHashedPassword_(a)) return String(a);
  return String(a || b || '');
}

/**
 * Indeks seluruh user: username(lower) → profil ringkas (tanpa password).
 * Cache mengikuti versi 'users'.
 */
function getUserIndex_() {
  if (_EXEC.userIdx) return _EXEC.userIdx;
  const key = 'users_idx_' + dataVersion_('users');
  _EXEC.userIdx = cached_(key, CACHE_TTL_USERS, function () {
    const idx = {};
    readTable_('USERS').forEach(r => {
      const u = norm_(r['Username']);
      if (!u || idx[u]) return;
      idx[u] = {
        username:   String(r['Username']).trim(),
        nama:       String(r['Nama'] || '').trim() || String(r['Username']).trim(),
        rawRole:    String(r['Role'] || '').trim(),
        role:       canonRole_(r['Role']) || '',
        aksesData:  String(r['AksesData'] || '').trim(),
        kodeOutlet: String(r['KodeOutlet'] || '').trim(),
        status:     norm_(r['Status']) === 'inactive' || norm_(r['Status']) === 'nonaktif' ? 'Inactive' : 'Active'
      };
    });
    return idx;
  });
  return _EXEC.userIdx;
}

// ─── Session Lifecycle ────────────────────────────────────────────────────────

function _sessionTtl_() {
  return Math.min(Math.max(getConfigNum_('session_ttl_hours', 6), 1), 6) * 3600;
}

/** Buat sesi baru. Token = UUID acak (tidak dapat ditebak). */
function createSession_(profile) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid().slice(0, 8);
  const now = Date.now();
  const data = {
    username:   profile.username,
    nama:       profile.nama,
    role:       profile.role,
    rawRole:    profile.rawRole,
    aksesData:  profile.aksesData,
    kodeOutlet: profile.kodeOutlet,
    createdAt:  now,
    lastSeen:   now,
    expiresAt:  now + _sessionTtl_() * 1000
  };
  CacheService.getScriptCache().put(_SESSION_PREFIX + token, JSON.stringify(data), _sessionTtl_());
  return token;
}

/** Ambil sesi mentah dari cache. Throw SESSION_EXPIRED. */
function getSession_(token) {
  if (!token || typeof token !== 'string') throw new Error('SESSION_EXPIRED: Token tidak valid.');
  const raw = CacheService.getScriptCache().get(_SESSION_PREFIX + token.trim());
  if (!raw) throw new Error('SESSION_EXPIRED: Sesi tidak ditemukan atau kedaluwarsa.');
  let s;
  try { s = JSON.parse(raw); } catch (e) { throw new Error('SESSION_EXPIRED: Sesi rusak.'); }
  if (!s.username || !s.role) throw new Error('SESSION_EXPIRED: Data sesi tidak valid.');
  return s;
}

/**
 * Validasi sesi + sinkron dengan data USERS terkini:
 *  - user dihapus / nonaktif → sesi dicabut
 *  - role / akses berubah → sesi diperbarui otomatis (tanpa perlu login ulang)
 *  - sliding expiration (diperbarui maksimal tiap 5 menit)
 */
function validateSession_(token) {
  const s = getSession_(token);
  const prof = getUserIndex_()[norm_(s.username)];
  if (!prof || prof.status === 'Inactive' || !prof.role) {
    destroySession_(token);
    throw new Error('SESSION_EXPIRED: Akun tidak aktif.');
  }
  let changed = false;
  ['nama', 'role', 'rawRole', 'aksesData', 'kodeOutlet'].forEach(k => {
    if (s[k] !== prof[k]) { s[k] = prof[k]; changed = true; }
  });
  const now = Date.now();
  if (changed || now - (s.lastSeen || 0) > 300000) {
    s.lastSeen = now;
    s.expiresAt = now + _sessionTtl_() * 1000;
    CacheService.getScriptCache().put(_SESSION_PREFIX + token.trim(), JSON.stringify(s), _sessionTtl_());
  }
  return s;
}

function destroySession_(token) {
  if (!token || typeof token !== 'string') return;
  try { CacheService.getScriptCache().remove(_SESSION_PREFIX + token.trim()); } catch (e) {}
}

function peekSession_(token) {
  try { return validateSession_(token); } catch (e) { return null; }
}

function refreshSession_(token, s) { /* ditangani validateSession_ */ }

// ─── Rate limit login ─────────────────────────────────────────────────────────

function _loginFailKey_(u) { return 'lf_' + compact_(u); }

function loginLocked_(username) {
  const n = Number(CacheService.getScriptCache().get(_loginFailKey_(username)) || 0);
  return n >= LOGIN_MAX_ATTEMPTS;
}

function registerLoginFail_(username) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(_loginFailKey_(username)) || 0) + 1;
  c.put(_loginFailKey_(username), String(n), LOGIN_LOCK_SECONDS);
  return n;
}

function clearLoginFail_(username) {
  try { CacheService.getScriptCache().remove(_loginFailKey_(username)); } catch (e) {}
}
