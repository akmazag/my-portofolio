/**
 * CINEMA HUB — Konfigurasi terpusat.
 *
 * - Konstanta aplikasi (CH) bersifat tetap di kode.
 * - Nilai rahasia & ID infrastruktur disimpan di Script Properties (tidak pernah dikirim ke klien).
 * - Nilai yang dapat diubah admin disimpan di sheet APP_CONFIG; default-nya ada di CH_CONFIG_DEFAULTS.
 */
const CH = Object.freeze({
  APP_VERSION: '1.0.0-phase1',
  BUILD_PHASE: 1,
  SCHEMA_VERSION: 1,
  DEFAULT_TZ: 'Asia/Jakarta',
  PROPS: Object.freeze({
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    BACKUP_SPREADSHEET_ID: 'BACKUP_SPREADSHEET_ID',
    ARCHIVE_SPREADSHEET_ID: 'ARCHIVE_SPREADSHEET_ID',
    ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
    FOLDER_IDS: 'FOLDER_IDS',
    PASSWORD_PEPPER: 'PASSWORD_PEPPER',
    OWNER_EMAIL: 'OWNER_EMAIL',
    TIMEZONE: 'TIMEZONE',
    INSTALLED_AT: 'INSTALLED_AT'
  }),
  DRIVE: Object.freeze({
    ROOT: 'CINEMA_HUB',
    FOLDERS: Object.freeze([
      'MOVIE_POSTERS', 'PROMO_BANNERS', 'CINEMA_LAYOUT', 'MALL_LAYOUT',
      'EDUCATION', 'EMPLOYEE_PHOTOS', 'PROBLEM_SOLVING', 'ANNOUNCEMENTS'
    ]),
    SYSTEM: '_SYSTEM',
    SYSTEM_FOLDERS: Object.freeze(['IMPORTS', 'BACKUPS', 'EXPORTS'])
  }),
  CACHE_TTL_SEC: 21600,          // batas maksimum CacheService (6 jam)
  SESSION_CACHE_SEC: 600,        // cache sesi 10 menit
  SESSION_TOUCH_SEC: 300,        // perbarui last_seen maksimal tiap 5 menit
  LOCK_TIMEOUT_MS: 10000,
  PASSWORD_ITERATIONS: 2000,
  SYSTEM_ACTOR: 'SYSTEM'
});

/** [key, defaultValue, type, description, isPublic] */
const CH_CONFIG_DEFAULTS = Object.freeze([
  ['APP_NAME', 'CINEMA HUB', 'string', 'Nama aplikasi', true],
  ['APP_TAGLINE', 'One Platform. One Knowledge. One Operation.', 'string', 'Tagline aplikasi', true],
  ['COMPANY_NAME', 'Cinema Group', 'string', 'Nama perusahaan yang tampil di portal', true],
  ['ENVIRONMENT', 'PRODUCTION', 'string', 'PRODUCTION atau DEMO (DEMO mengizinkan seedDemoData)', false],
  ['AUTH_MODE', 'PASSWORD', 'string', 'PASSWORD | WORKSPACE | HYBRID', false],
  ['SESSION_IDLE_MINUTES', '60', 'int', 'Sesi berakhir setelah tidak aktif (menit)', false],
  ['SESSION_ABSOLUTE_HOURS', '12', 'int', 'Umur maksimum sesi tanpa "Ingat saya" (jam)', false],
  ['SESSION_REMEMBER_DAYS', '7', 'int', 'Umur sesi dengan "Ingat saya" (hari)', true],
  ['MAX_SESSIONS_PER_USER', '5', 'int', 'Jumlah sesi aktif maksimum per pengguna', false],
  ['LOGIN_MAX_ATTEMPTS', '5', 'int', 'Batas percobaan login gagal', false],
  ['LOGIN_LOCK_MINUTES', '15', 'int', 'Durasi kunci akun setelah gagal berulang (menit)', false],
  ['PASSWORD_MIN_LENGTH', '8', 'int', 'Panjang minimum password', true],
  ['IMPORT_MAX_ROWS', '5000', 'int', 'Jumlah baris maksimum per import', true],
  ['IMPORT_MAX_FILE_MB', '5', 'int', 'Ukuran file import maksimum (MB)', true],
  ['UPLOAD_MAX_MB_IMAGE', '5', 'int', 'Ukuran gambar maksimum (MB)', true],
  ['UPLOAD_MAX_MB_DOCUMENT', '10', 'int', 'Ukuran dokumen maksimum (MB)', true],
  ['UPLOAD_MAX_MB_VIDEO', '10', 'int', 'Ukuran video maksimum (MB)', true],
  ['PAGE_SIZE_CARDS', '12', 'int', 'Jumlah kartu per halaman', true],
  ['PAGE_SIZE_TABLE', '20', 'int', 'Jumlah baris tabel per halaman', true],
  ['LOG_RETENTION_DAYS', '90', 'int', 'Umur log sebelum diarsipkan (hari)', false],
  ['SCHEMA_VERSION', '1', 'int', 'Versi skema database', false]
]);

const Config = (() => {
  function props() {
    return PropertiesService.getScriptProperties();
  }

  function prop(key) {
    return props().getProperty(key);
  }

  function setProp(key, value) {
    props().setProperty(key, String(value));
  }

  function isInstalled() {
    return !!prop(CH.PROPS.SPREADSHEET_ID);
  }

  function cast(value, type) {
    const v = value === null || value === undefined ? '' : value;
    switch (type) {
      case 'int': {
        const n = parseInt(v, 10);
        return isNaN(n) ? 0 : n;
      }
      case 'bool':
        return v === true || String(v).toUpperCase() === 'TRUE';
      case 'json':
        try { return typeof v === 'string' ? JSON.parse(v || 'null') : v; } catch (e) { return null; }
      default:
        return String(v);
    }
  }

  /** Semua konfigurasi (default + APP_CONFIG), dimemo per eksekusi. */
  function all() {
    return Scope.get('config:all', () => {
      const map = {};
      CH_CONFIG_DEFAULTS.forEach((d) => {
        map[d[0]] = { value: cast(d[1], d[2]), type: d[2], isPublic: d[4] };
      });
      if (isInstalled()) {
        try {
          Repo.table('APP_CONFIG').all().forEach((row) => {
            const type = row.value_type || 'string';
            map[row.config_key] = { value: cast(row.config_value, type), type, isPublic: row.is_public === true };
          });
        } catch (e) {
          console.warn('APP_CONFIG tidak dapat dibaca, memakai default: ' + e.message);
        }
      }
      return map;
    });
  }

  function get(key, fallback) {
    const entry = all()[key];
    return entry === undefined ? fallback : entry.value;
  }

  function publicConfig() {
    const map = all();
    const out = {};
    Object.keys(map).forEach((k) => {
      if (map[k].isPublic) out[k] = map[k].value;
    });
    out.TIMEZONE = Utils.tz();
    out.APP_VERSION = CH.APP_VERSION;
    out.BUILD_PHASE = CH.BUILD_PHASE;
    return out;
  }

  return { prop, setProp, isInstalled, get, all, publicConfig, cast };
})();
