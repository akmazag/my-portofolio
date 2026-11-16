/**
 * CINEMA HUB — Error standar aplikasi.
 * AppError = error terduga (pesan aman ditampilkan ke pengguna).
 * Error lain dianggap INTERNAL_ERROR: pesan generik ke klien, detail ke ERROR_LOGS.
 */
const Errors = (() => {
  const CATALOG = Object.freeze({
    BAD_REQUEST: 'Permintaan tidak valid.',
    UNAUTHENTICATED: 'Silakan masuk terlebih dahulu.',
    SESSION_EXPIRED: 'Sesi Anda telah berakhir. Silakan masuk kembali.',
    INVALID_CREDENTIALS: 'Username/email atau password salah.',
    ACCOUNT_INACTIVE: 'Akun Anda tidak aktif. Hubungi administrator.',
    PASSWORD_CHANGE_REQUIRED: 'Anda wajib mengganti password sebelum melanjutkan.',
    FORBIDDEN: 'Anda tidak memiliki akses ke fitur ini.',
    NOT_FOUND: 'Data tidak ditemukan.',
    VALIDATION_ERROR: 'Data yang dikirim tidak valid.',
    CONFLICT: 'Data telah diubah oleh pengguna lain. Muat ulang halaman lalu coba lagi.',
    DUPLICATE: 'Data dengan ID yang sama sudah ada.',
    RATE_LIMITED: 'Terlalu banyak percobaan. Silakan coba lagi beberapa saat lagi.',
    LOCK_TIMEOUT: 'Sistem sedang memproses perubahan lain. Coba lagi dalam beberapa detik.',
    FILE_TOO_LARGE: 'Ukuran file melebihi batas yang diizinkan.',
    FILE_TYPE_NOT_ALLOWED: 'Jenis file tidak diizinkan.',
    NOT_INSTALLED: 'Aplikasi belum diinisialisasi. Administrator perlu menjalankan setupCinemaHub() dari Apps Script editor.',
    INTERNAL_ERROR: 'Terjadi kesalahan pada sistem. Silakan coba lagi.'
  });

  class AppError extends Error {
    constructor(code, message, details) {
      const known = Object.prototype.hasOwnProperty.call(CATALOG, code);
      super(message || (known ? CATALOG[code] : CATALOG.INTERNAL_ERROR));
      this.name = 'AppError';
      this.code = known ? code : 'INTERNAL_ERROR';
      this.details = details || null;
    }
  }

  function create(code, message, details) {
    return new AppError(code, message, details);
  }

  function is(err) {
    return err instanceof AppError;
  }

  return { AppError, create, is, CATALOG };
})();
