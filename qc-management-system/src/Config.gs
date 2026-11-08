/**
 * Config.gs
 * Konstanta global, skema sheet, enum, dan default konfigurasi.
 * @version 2.0.0
 *
 * CATATAN AUDIT (v2.0.0):
 *  - Kolom password pada sheet Users adalah "Password" (bukan "PasswordHash").
 *    Nilai disimpan sebagai hash bersalt (format: sha256$<iter>$<salt>$<hash>).
 *    Password plaintext lama otomatis dimigrasikan menjadi hash saat login berhasil
 *    atau melalui menu "QC Admin → Hash Seluruh Password".
 *  - Kolom baru hanya DITAMBAHKAN di sisi kanan sheet (tidak pernah menimpa header lama).
 */

// ─── Timezone & TTL ───────────────────────────────────────────────────────────
const TZ                  = 'Asia/Jakarta';
const SESSION_TTL         = 21600;   // 6 jam (batas maksimum CacheService)
const CACHE_TTL_MASTER    = 3600;    // 1 jam
const CACHE_TTL_SCOPE     = 1800;    // 30 menit
const CACHE_TTL_DASHBOARD = 300;     // 5 menit
const CACHE_TTL_CONFIG    = 600;     // 10 menit
const CACHE_TTL_USERS     = 600;     // 10 menit (indeks status user untuk revokasi sesi)

// ─── File / Drive ─────────────────────────────────────────────────────────────
const MAX_PDF_BYTES    = 10 * 1024 * 1024; // 10 MB (dapat dioverride APP_CONFIG.max_pdf_mb)
const PDF_FOLDER_NAME  = 'QC_Management_PDF';

// ─── Versioning ───────────────────────────────────────────────────────────────
const APP_VERSION = '2.0.0';

// ─── Keamanan ─────────────────────────────────────────────────────────────────
const PASSWORD_HASH_ITER   = 300;  // iterasi SHA-256 bersalt
const LOGIN_MAX_ATTEMPTS   = 5;    // percobaan gagal sebelum dikunci sementara
const LOGIN_LOCK_SECONDS   = 900;  // 15 menit

// ─── Cache Key Prefixes ───────────────────────────────────────────────────────
const CACHE_KEY_MASTER        = 'master_data';
const CACHE_KEY_SCOPE_PREFIX  = 'scope_';
const CACHE_KEY_DASH_PREFIX   = 'dash_';

// ─── Role Enum ────────────────────────────────────────────────────────────────
const ROLES = Object.freeze({
  QC:         'QC',
  RM:         'RM',
  AM:         'AM',
  OUTLET:     'Outlet',
  QC_AREA:    'QC Area',
  SPECIALIST: 'Specialist'
});

/** Alias penulisan role di sheet Users → role kanonik. */
const ROLE_ALIASES = Object.freeze({
  'qc': ROLES.QC, 'qc office': ROLES.QC, 'admin': ROLES.QC, 'administrator': ROLES.QC,
  'admin qc': ROLES.QC, 'admin qc office': ROLES.QC, 'qc admin': ROLES.QC,
  'super admin': ROLES.QC, 'superadmin': ROLES.QC,
  'rm': ROLES.RM, 'regional manager': ROLES.RM, 'region manager': ROLES.RM,
  'am': ROLES.AM, 'area manager': ROLES.AM,
  'outlet': ROLES.OUTLET, 'cinema': ROLES.OUTLET, 'store': ROLES.OUTLET,
  'qc area': ROLES.QC_AREA, 'qcarea': ROLES.QC_AREA,
  'specialist': ROLES.SPECIALIST, 'kabag': ROLES.SPECIALIST, 'specialist (kabag)': ROLES.SPECIALIST,
  'kabag qc area': ROLES.SPECIALIST, 'specialist kabag': ROLES.SPECIALIST
});

// ─── Grade Thresholds (default, bisa di-override dari APP_CONFIG) ─────────────
const DEFAULT_GRADE = Object.freeze({ A_MIN: 90, B_MIN: 80, C_MIN: 70, D_MIN: 60 });

// ─── Default APP_CONFIG (di-seed bila belum ada) ──────────────────────────────
const DEFAULT_CONFIG = Object.freeze([
  ['warning_threshold_days', '30',      'Ambang batas hari peringatan cleaning jatuh tempo'],
  ['grade_A_min',            '90',      'Nilai minimum untuk Grade A (%)'],
  ['grade_B_min',            '80',      'Nilai minimum untuk Grade B (%)'],
  ['grade_C_min',            '70',      'Nilai minimum untuk Grade C (%)'],
  ['grade_D_min',            '60',      'Nilai minimum untuk Grade D (%)'],
  ['max_pdf_mb',             '10',      'Ukuran maksimum upload PDF (MB)'],
  ['session_ttl_hours',      '6',       'Durasi sesi login (jam, maksimum 6)'],
  ['na_item_policy',         'exclude', 'Kebijakan item NA: exclude (tidak dihitung ke skor maksimum)'],
  ['grading_method',         'ratio',   'ratio = Σ skor aktual / Σ skor maksimum (PRD); average = rata-rata persentase per checklist'],
  ['pdf_required',           'false',   'true = checklist tanpa PDF tidak dihitung ke grading final'],
  ['visit_period_months',    '3',       'Panjang periode target kunjungan (bulan) untuk Visit Achievement'],
  ['upcoming_visit_days',    '7',       'Jadwal kunjungan dalam N hari ke depan ditandai Upcoming'],
  ['app_version',            APP_VERSION, 'Versi aplikasi'],
  ['maintenance_mode',       'false',   'Mode maintenance (true = hanya Admin yang dapat login)']
]);

// ─── Schema: header kolom setiap sheet ────────────────────────────────────────
// Urutan hanya dipakai saat membuat sheet BARU. Untuk sheet yang sudah ada,
// penulisan mengikuti header aktual; kolom yang belum ada ditambahkan di kanan.
const SCHEMA = Object.freeze({

  USERS: [
    'Username', 'Password', 'Role', 'Nama',
    'AksesData', 'KodeOutlet', 'Status',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
  ],

  KODE: [
    'KodeOutlet', 'NamaOutlet', 'LOB', 'Class', 'Area',
    'AM', 'Kota', 'RM', 'KabagQCArea', 'StatusOutlet'
  ],

  OP: ['NAMA', 'OUTLET', 'JABATAN', 'AREA', 'REGIO', 'DIVISI'],

  INTERVAL: ['Class', 'BulanCuciKursi', 'BulanCuciKarpet', 'STUDIO'],

  TRANSAKSI_CLEANING: [
    'IDCleaning', 'Timestamp', 'Tanggal', 'KodeOutlet', 'NamaOutlet',
    'Class', 'Area', 'Region', 'Studio', 'JenisCleaning', 'Vendor',
    'Keterangan', 'TargetInterval', 'Status',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
  ],

  LOG_VISIT: [
    'IDVisit', 'TanggalRencana', 'NamaQCArea', 'KodeOutlet', 'NamaOutlet',
    'Area', 'Region', 'Status', 'TanggalRealisasi', 'ChecklistID',
    'Keterangan', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
  ],

  MASTER_CHECK: [
    'IDCheck', 'Kategori', 'NamaChecklist', 'Deskripsi',
    'Bobot', 'ScoreMax', 'StatusAktif', 'UrutanTampilan', 'Aspek'
  ],

  CHECKLIST_HEADER: [
    'IDChecklist', 'IDVisit', 'QCArea', 'Outlet', 'Tanggal',
    'Region', 'Area', 'TipeOutlet', 'Kategori',
    'TotalScoreAktual', 'TotalScoreMax', 'GradePercentage', 'Grade',
    'FileDocumentID', 'Status', 'CreatedAt', 'CreatedBy', 'SubmittedAt',
    'KodeOutlet', 'StatusDokumen'
  ],

  CHECKLIST_DETAIL: [
    'IDDetail', 'IDChecklist', 'IDItem', 'Kategori', 'NamaItem',
    'Score', 'ScoreMax', 'IsNA', 'Keterangan', 'CatatanTemuan', 'CreatedAt'
  ],

  FILE_DOCUMENT: [
    'IDDocument', 'IDReferensi', 'TipeReferensi', 'NamaFile',
    'DriveFileID', 'DriveURL', 'TipeFile', 'UkuranBytes',
    'UploadedAt', 'UploadedBy'
  ],

  AUDIT_LOG: [
    'IDLog', 'Timestamp', 'UserID', 'NamaUser',
    'Aksi', 'EntityType', 'EntityID',
    'DataSebelum', 'DataSesudah', 'Role'
  ],

  APP_CONFIG: ['ConfigKey', 'ConfigValue', 'Deskripsi', 'UpdatedAt', 'UpdatedBy'],

  VISIT_HISTORY: [
    'IDHistory', 'IDVisit', 'StatusLama', 'StatusBaru',
    'Keterangan', 'Timestamp', 'ChangedBy'
  ]
});

/**
 * Alias header: nama kolom kanonik → nama alternatif yang mungkin dipakai di sheet.
 * Pencocokan sudah toleran terhadap spasi/huruf besar (compact_), alias ini
 * menangani perbedaan nama yang benar-benar berbeda.
 */
const HEADER_ALIASES = Object.freeze({
  USERS:    { Password: ['PasswordHash', 'Pass', 'Kata Sandi'], Nama: ['Name', 'NamaLengkap'] },
  KODE:     { KodeOutlet: ['Kode', 'Code', 'Outlet Code'], NamaOutlet: ['Nama Outlet', 'Outlet'],
              KabagQCArea: ['KABAG QC AREA', 'Kabag Area', 'Kabag'], RM: ['Region', 'Regio'] },
  OP:       { REGIO: ['REGION'] },
  INTERVAL: { Class: ['Kelas'] }
});

// ─── Allowed Enum Values ──────────────────────────────────────────────────────
const ENUM = Object.freeze({
  STATUS_USER:     ['Active', 'Inactive'],
  STATUS_OUTLET:   ['Active', 'Inactive'],
  STATUS_VISIT:    ['Planned', 'In Progress', 'Completed', 'Rescheduled', 'Cancelled', 'Overdue'],
  JENIS_CLEANING:  ['Cuci Kursi', 'Cuci Karpet'],
  KATEGORI_CHECK:  ['Cinema', 'F&B', 'Premiere'],
  GRADE:           ['A', 'B', 'C', 'D', 'E'],
  TIPE_FILE:       ['PDF']
});
