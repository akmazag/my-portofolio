/**
 * CINEMA HUB — Hashing password.
 *
 * Algoritma: PBKDF2-HMAC-SHA256 (RFC 8018), dkLen 32, salt 16 byte acak per user.
 * Password terlebih dahulu di-HMAC dengan PEPPER (Script Properties) sehingga bocornya sheet USERS
 * saja tidak cukup untuk serangan offline.
 * Format penyimpanan: password_algo = "pbkdf2-sha256$<iterasi>" → memungkinkan upgrade iterasi bertahap.
 */
const Password = (() => {
  const ALGO = 'pbkdf2-sha256';
  const DUMMY_SALT = 'Q0lORU1BX0hVQl9EVU1NWQ==';

  function bytes(x) { return Array.prototype.slice.call(x); }

  function pepper() {
    const p = Config.prop(CH.PROPS.PASSWORD_PEPPER);
    if (!p) throw Errors.create('NOT_INSTALLED');
    return p;
  }

  function derive(password, saltB64, iterations) {
    const key = bytes(Utilities.computeHmacSha256Signature(String(password), pepper(), Utilities.Charset.UTF_8));
    const salt = bytes(Utilities.base64Decode(saltB64));
    let u = bytes(Utilities.computeHmacSha256Signature(salt.concat([0, 0, 0, 1]), key));
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = bytes(Utilities.computeHmacSha256Signature(u, key));
      for (let j = 0; j < t.length; j++) t[j] ^= u[j];
    }
    return Utilities.base64Encode(t);
  }

  function hash(password) {
    const salt = Utilities.base64Encode(Utils.randomBytes(16));
    const iterations = CH.PASSWORD_ITERATIONS;
    return {
      password_hash: derive(password, salt, iterations),
      password_salt: salt,
      password_algo: ALGO + '$' + iterations
    };
  }

  function safeEqual(a, b) {
    const x = String(a || '');
    const y = String(b || '');
    let diff = x.length ^ y.length;
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0;
  }

  function verify(password, user) {
    const m = /^pbkdf2-sha256\$(\d{3,6})$/.exec(String(user && user.password_algo || ''));
    if (!m || !user.password_salt || !user.password_hash) return false;
    return safeEqual(derive(password, user.password_salt, Number(m[1])), user.password_hash);
  }

  /** Dipakai saat user tidak ditemukan agar waktu respons setara (mencegah enumerasi akun). */
  function burn(password) {
    derive(password || 'x', DUMMY_SALT, CH.PASSWORD_ITERATIONS);
  }

  function needsRehash(user) {
    return user.password_algo !== ALGO + '$' + CH.PASSWORD_ITERATIONS;
  }

  /** Mengembalikan pesan kesalahan kebijakan atau '' bila valid. */
  function policyError(password, username) {
    const min = Config.get('PASSWORD_MIN_LENGTH', 8);
    const pw = String(password || '');
    if (pw.length < min) return 'Password minimal ' + min + ' karakter.';
    if (pw.length > 128) return 'Password maksimal 128 karakter.';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password harus mengandung huruf dan angka.';
    if (username && pw.toLowerCase().indexOf(String(username).toLowerCase()) >= 0) return 'Password tidak boleh mengandung username.';
    return '';
  }

  function temporary() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const b = Utils.randomBytes(10);
    let s = '';
    for (let i = 0; i < b.length; i++) s += alphabet[(b[i] & 0xff) % alphabet.length];
    return s.slice(0, 5) + '#' + s.slice(5) + '7';
  }

  return { hash, verify, burn, needsRehash, policyError, temporary, derive };
})();
