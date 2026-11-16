/**
 * CINEMA HUB — Definisi skema database (single source of truth).
 *
 * Dipakai oleh: inisialisasi database, repository (serialisasi tipe), validasi, dan engine import.
 * Kolom ditulis "nama:tipe" (tipe default = string).
 * Tipe: string | text | int | number | bool | date | time | datetime | json | csv
 *
 * Aturan migrasi: kolom baru SELALU ditambahkan di akhir daftar. Jangan mengganti nama kolom.
 */
const Schema = (() => {
  const AUDIT = ['status', 'created_at:datetime', 'created_by', 'updated_at:datetime', 'updated_by', 'row_version:int'];
  const TABLES = {};
  const ORDER = [];

  const S = Object.freeze({
    ACTIVE_INACTIVE: ['ACTIVE', 'INACTIVE'],
    ACTIVE_ARCHIVED: ['ACTIVE', 'ARCHIVED'],
    PUBLISH: ['DRAFT', 'PUBLISHED', 'ARCHIVED']
  });

  function define(name, opts, cols) {
    const specs = cols.concat(opts.audit === false ? [] : AUDIT);
    const columns = specs.map((spec) => {
      const parts = spec.split(':');
      return Object.freeze({ name: parts[0], type: parts[1] || 'string' });
    });
    const seen = {};
    columns.forEach((c) => {
      if (seen[c.name]) throw new Error('Kolom duplikat ' + name + '.' + c.name);
      seen[c.name] = true;
    });
    TABLES[name] = Object.freeze({
      name,
      label: opts.label || name,
      key: columns[0].name,
      prefix: opts.prefix || null,
      cache: opts.cache !== false,
      audit: opts.audit !== false,
      appendOnly: opts.appendOnly === true,
      defaultStatus: opts.defaultStatus || 'ACTIVE',
      enums: Object.freeze(opts.enums || {}),
      columns: Object.freeze(columns)
    });
    ORDER.push(name);
  }

  // ───────────── KEAMANAN ─────────────
  define('USERS', {
    label: 'Pengguna', prefix: 'USR',
    enums: { status: ['ACTIVE', 'INACTIVE', 'LOCKED'] }
  }, ['user_id', 'username', 'email', 'full_name', 'role_id', 'employee_id', 'outlet_id', 'area',
    'password_hash', 'password_salt', 'password_algo', 'must_change_password:bool', 'failed_attempts:int',
    'locked_until:datetime', 'last_login_at:datetime']);

  define('ROLES', { label: 'Role', enums: { status: S.ACTIVE_INACTIVE } },
    ['role_id', 'role_name', 'description:text', 'level:int', 'is_system:bool']);

  define('PERMISSIONS', { label: 'Permission', audit: false, enums: { status: S.ACTIVE_INACTIVE } },
    ['permission_key', 'module', 'action', 'description:text', 'is_sensitive:bool', 'status']);

  define('ROLE_PERMISSIONS', { label: 'Role Permission', prefix: 'RPM', enums: { status: S.ACTIVE_INACTIVE } },
    ['rp_id', 'role_id', 'permission_key']);

  define('SESSIONS', {
    label: 'Sesi', prefix: 'SES', audit: false, cache: false,
    enums: { status: ['ACTIVE', 'REVOKED', 'EXPIRED'] }
  }, ['session_id', 'token_hash', 'user_id', 'created_at:datetime', 'last_seen_at:datetime',
    'idle_expires_at:datetime', 'absolute_expires_at:datetime', 'remember:bool', 'user_agent',
    'status', 'revoked_at:datetime', 'revoked_reason']);

  // ───────────── MASTER ─────────────
  define('OUTLETS', { label: 'Outlet', enums: { status: S.ACTIVE_INACTIVE } },
    ['outlet_id', 'outlet_name', 'mall_name', 'city', 'area', 'region', 'address:text', 'studio_count:int']);

  define('LOOKUPS', { label: 'Lookup', prefix: 'LKP', enums: { status: S.ACTIVE_INACTIVE } },
    ['lookup_id', 'type', 'code', 'label', 'sort_order:int', 'meta:json']);

  define('MOVIES', { label: 'Film', enums: { status: S.ACTIVE_ARCHIVED } },
    ['movie_id', 'title', 'genre:csv', 'duration_min:int', 'age_rating', 'synopsis:text',
      'poster_file_id', 'poster_url']);

  define('EMPLOYEES', { label: 'Karyawan', enums: { status: S.ACTIVE_INACTIVE, employment_status: ['TETAP', 'KONTRAK', 'PROBATION', 'MAGANG'] } },
    ['employee_id', 'full_name', 'nik', 'photo_file_id', 'position', 'department', 'outlet_id', 'area',
      'email', 'phone', 'join_date:date', 'employment_status']);

  // ───────────── TRANSAKSI ─────────────
  define('MOVIE_TODAY', { label: 'Jadwal Tayang', prefix: 'SCH', enums: { status: ['ACTIVE', 'CANCELLED', 'ARCHIVED'] } },
    ['schedule_id', 'show_date:date', 'movie_id', 'outlet_id', 'studio', 'show_time:time', 'import_id']);

  define('UPCOMING_MOVIES', {
    label: 'Upcoming Movie', prefix: 'UPC',
    enums: { status: S.ACTIVE_ARCHIVED, upcoming_status: ['COMING_SOON', 'PRESALE', 'POSTPONED'] }
  }, ['upcoming_id', 'movie_id', 'release_date:date', 'upcoming_status', 'import_id']);

  // ───────────── KONTEN ─────────────
  define('PROMOS', { label: 'Promo', prefix: 'PRM', enums: { status: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] } },
    ['promo_id', 'promo_name', 'description:text', 'terms:text', 'start_date:date', 'end_date:date', 'category',
      'image_file_id', 'image_url', 'outlets:csv', 'info_link', 'import_id']);

  define('CINEMA_LAYOUT', { label: 'Layout Bioskop', prefix: 'CLY', defaultStatus: 'PUBLISHED', enums: { status: S.PUBLISH } },
    ['layout_id', 'outlet_id', 'category', 'location_name', 'description:text', 'access_guide:text',
      'operational_instruction:text', 'special_notes:text', 'image_file_ids:json', 'diagram_file_ids:json',
      'document_file_ids:json']);

  define('MALL_LAYOUT', { label: 'Layout Mall', prefix: 'MLY', defaultStatus: 'PUBLISHED', enums: { status: S.PUBLISH } },
    ['layout_id', 'mall_name', 'outlet_id', 'area', 'location', 'category', 'description:text',
      'access_guide:text', 'image_file_ids:json', 'layout_file_ids:json', 'document_file_ids:json']);

  define('EDUCATION', {
    label: 'Materi Edukasi', prefix: 'EDU', defaultStatus: 'DRAFT',
    enums: { status: S.PUBLISH, format: ['ARTICLE', 'PDF', 'PPT', 'VIDEO', 'IMAGE', 'LINK'] }
  }, ['education_id', 'title', 'category', 'format', 'description:text', 'content_md:text',
    'thumbnail_file_id', 'file_id', 'preview_file_id', 'external_url', 'author_user_id', 'author_name',
    'published_at:datetime', 'is_featured:bool', 'estimated_minutes:int', 'view_count:int']);

  define('PROBLEMS', {
    label: 'Problem', prefix: 'PRB', defaultStatus: 'DRAFT',
    enums: { status: ['DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'] }
  }, ['problem_id', 'title', 'category', 'outlet_id', 'description:text', 'symptoms:text',
    'occurred_at:datetime', 'media_file_ids:json', 'related_problem_ids:json', 'related_education_ids:json',
    'tags:csv', 'author_user_id', 'author_name', 'accepted_solution_id', 'review_note:text', 'reviewed_by',
    'reviewed_at:datetime', 'helpful_count:int', 'view_count:int']);

  define('SOLUTIONS', {
    label: 'Solusi', prefix: 'SOL', defaultStatus: 'SUBMITTED',
    enums: { status: ['SUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED'] }
  }, ['solution_id', 'problem_id', 'root_cause:text', 'steps_json:json', 'prevention:text',
    'is_verified:bool', 'media_file_ids:json', 'author_user_id', 'author_name', 'outlet_id',
    'review_note:text', 'reviewed_by', 'reviewed_at:datetime', 'helpful_count:int']);

  define('ANNOUNCEMENTS', {
    label: 'Pengumuman', prefix: 'ANN', defaultStatus: 'DRAFT',
    enums: { status: S.PUBLISH, priority: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] }
  }, ['announcement_id', 'title', 'body_md:text', 'category', 'attachment_file_ids:json',
    'publish_at:datetime', 'expire_at:datetime', 'author_user_id', 'author_name', 'priority',
    'is_pinned:bool', 'target_roles:csv', 'target_areas:csv', 'target_outlets:csv']);

  // ───────────── INTERAKSI ─────────────
  define('COMMENTS', { label: 'Komentar', prefix: 'CMT', defaultStatus: 'VISIBLE', enums: { status: ['VISIBLE', 'HIDDEN'] } },
    ['comment_id', 'entity_type', 'entity_id', 'user_id', 'user_name', 'body:text']);

  define('USER_ACTIVITY', { label: 'Aktivitas Pengguna', prefix: 'ACT', audit: false },
    ['activity_id', 'user_id', 'entity_type', 'entity_id', 'activity_type', 'value',
      'created_at:datetime', 'updated_at:datetime']);

  define('NOTIFICATIONS', { label: 'Notifikasi', prefix: 'NTF', audit: false },
    ['notification_id', 'user_id', 'type', 'title', 'message:text', 'route', 'is_read:bool',
      'created_at:datetime', 'read_at:datetime']);

  // ───────────── SISTEM ─────────────
  define('FILES', { label: 'File', prefix: 'FIL', audit: false, enums: { status: S.ACTIVE_ARCHIVED } },
    ['file_id', 'drive_file_id', 'module', 'entity_type', 'entity_id', 'original_name', 'mime_type',
      'size_bytes:int', 'sha256', 'folder_key', 'required_permission', 'status', 'uploaded_by',
      'uploaded_at:datetime', 'archived_at:datetime']);

  define('IMPORT_LOGS', {
    label: 'Riwayat Import', prefix: 'IMP', audit: false, cache: false,
    enums: { status: ['COMPLETED', 'PARTIAL', 'FAILED', 'ROLLED_BACK'], mode: ['APPEND', 'REPLACE'] }
  }, ['import_id', 'module', 'mode', 'file_name', 'source_file_id', 'total_rows:int', 'success_rows:int',
    'failed_rows:int', 'duplicate_rows:int', 'errors_json:json', 'backup_ref', 'status',
    'started_at:datetime', 'finished_at:datetime', 'duration_ms:int', 'executed_by']);

  define('AUDIT_LOGS', {
    label: 'Audit Log', prefix: 'AUD', audit: false, cache: false, appendOnly: true,
    enums: { result: ['SUCCESS', 'DENIED', 'FAILED'] }
  }, ['audit_id', 'timestamp:datetime', 'user_id', 'username', 'role_id', 'action', 'module',
    'entity_type', 'entity_id', 'result', 'detail_json:json', 'session_ref']);

  define('ERROR_LOGS', { label: 'Error Log', prefix: 'ERR', audit: false, cache: false, appendOnly: true },
    ['error_id', 'timestamp:datetime', 'user_id', 'action', 'error_code', 'message:text', 'stack:text',
      'context_json:json']);

  define('APP_CONFIG', { label: 'Konfigurasi', audit: false },
    ['config_key', 'config_value:text', 'value_type', 'description:text', 'is_public:bool',
      'updated_at:datetime', 'updated_by']);

  function get(name) {
    const def = TABLES[name];
    if (!def) throw new Error('Tabel tidak dikenal: ' + name);
    return def;
  }

  function list() {
    return ORDER.map((n) => TABLES[n]);
  }

  function names() {
    return ORDER.slice();
  }

  return { get, list, names };
})();
