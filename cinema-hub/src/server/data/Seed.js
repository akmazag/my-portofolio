/**
 * CINEMA HUB — Data referensi (roles, permissions, matriks, lookup, konfigurasi).
 * Idempoten: hanya menambahkan yang belum ada, tidak pernah menimpa perubahan admin.
 */
const Seed = (() => {
  const ROLES = [
    ['SUPER_ADMIN', 'Super Admin', 'Akses penuh seluruh modul, pengguna, role, audit, dan pengaturan.', 100],
    ['ADMIN', 'Admin', 'Mengelola konten portal, import data, materi edukasi, dan informasi operasional.', 80],
    ['MANAGEMENT', 'Management', 'Melihat seluruh informasi, laporan, knowledge, dan profil karyawan.', 60],
    ['CINEMA_MANAGER', 'Cinema Manager', 'Mengakses informasi operasional, edukasi, problem & solving, dan direktori karyawan.', 40],
    ['EMPLOYEE', 'Employee', 'Mengakses informasi operasional harian sesuai permission.', 20]
  ];

  /** [key, description, sensitive] */
  const PERMISSIONS = [
    ['dashboard.view', 'Melihat dashboard', false],
    ['report.view', 'Melihat statistik & laporan', false],
    ['movie.view', 'Melihat jadwal & upcoming movies', false],
    ['movie.manage', 'Mengelola data film & jadwal', false],
    ['movie.import', 'Import data film dari Excel', false],
    ['promo.view', 'Melihat promo', false],
    ['promo.manage', 'Mengelola promo', false],
    ['promo.import', 'Import promo dari Excel', false],
    ['layout_cinema.view', 'Melihat layout bioskop', false],
    ['layout_cinema.download', 'Mengunduh dokumen layout bioskop', false],
    ['layout_cinema.manage', 'Mengelola layout bioskop', false],
    ['layout_mall.view', 'Melihat layout mall', false],
    ['layout_mall.download', 'Mengunduh dokumen layout mall', false],
    ['layout_mall.manage', 'Mengelola layout mall', false],
    ['education.view', 'Melihat materi edukasi', false],
    ['education.download', 'Mengunduh materi edukasi', false],
    ['education.manage', 'Mengelola materi edukasi', false],
    ['problem.view', 'Melihat problem & solving', false],
    ['problem.submit', 'Mengirim problem & solusi', false],
    ['problem.comment', 'Memberi komentar & feedback', false],
    ['problem.review', 'Review & publish problem/solusi', false],
    ['problem.manage', 'Mengelola seluruh problem & solusi', false],
    ['employee.view', 'Melihat direktori karyawan', false],
    ['employee.view_contact', 'Melihat nomor telepon karyawan', true],
    ['employee.view_sensitive', 'Melihat NIK karyawan', true],
    ['employee.manage', 'Mengelola data karyawan', true],
    ['employee.import', 'Import data karyawan dari Excel', true],
    ['announcement.view', 'Melihat pengumuman', false],
    ['announcement.manage', 'Mengelola pengumuman', false],
    ['content.manage', 'Akses Content Management', false],
    ['import.manage', 'Riwayat & rollback import', false],
    ['file.upload', 'Mengunggah file', false],
    ['user.manage', 'Mengelola pengguna', true],
    ['role.manage', 'Mengelola role & permission', true],
    ['audit.view', 'Melihat audit log', true],
    ['settings.manage', 'Mengelola pengaturan aplikasi', true]
  ];

  const EMPLOYEE_PERMS = ['dashboard.view', 'movie.view', 'promo.view', 'layout_cinema.view', 'layout_cinema.download',
    'layout_mall.view', 'layout_mall.download', 'education.view', 'education.download', 'problem.view',
    'problem.submit', 'problem.comment', 'announcement.view', 'file.upload'];
  const CM_PERMS = EMPLOYEE_PERMS.concat(['report.view', 'employee.view', 'employee.view_contact']);
  const MGMT_PERMS = CM_PERMS.concat(['employee.view_sensitive', 'announcement.manage']);
  const ADMIN_PERMS = MGMT_PERMS.concat(['movie.manage', 'movie.import', 'promo.manage', 'promo.import',
    'layout_cinema.manage', 'layout_mall.manage', 'education.manage', 'problem.review', 'problem.manage',
    'employee.manage', 'employee.import', 'content.manage', 'import.manage']);

  const MATRIX = {
    SUPER_ADMIN: PERMISSIONS.map((p) => p[0]),
    ADMIN: ADMIN_PERMS,
    MANAGEMENT: MGMT_PERMS,
    CINEMA_MANAGER: CM_PERMS,
    EMPLOYEE: EMPLOYEE_PERMS
  };

  const LOOKUPS = {
    GENRE: [['ACTION', 'Aksi'], ['ADVENTURE', 'Petualangan'], ['ANIMATION', 'Animasi'], ['COMEDY', 'Komedi'],
      ['CRIME', 'Kriminal'], ['DOCUMENTARY', 'Dokumenter'], ['DRAMA', 'Drama'], ['FAMILY', 'Keluarga'],
      ['FANTASY', 'Fantasi'], ['HORROR', 'Horor'], ['MUSICAL', 'Musikal'], ['MYSTERY', 'Misteri'],
      ['ROMANCE', 'Romantis'], ['SCIFI', 'Fiksi Ilmiah'], ['THRILLER', 'Thriller']],
    AGE_RATING: [['SU', 'SU — Semua Umur'], ['13+', '13+ — Remaja'], ['17+', '17+ — Dewasa'], ['21+', '21+ — Dewasa']],
    PROMO_CATEGORY: [['TICKET', 'Tiket'], ['FNB', 'F&B'], ['PAYMENT', 'Bank & E-Wallet'], ['MEMBERSHIP', 'Membership'],
      ['BUNDLING', 'Paket Bundling'], ['SEASONAL', 'Musiman'], ['CORPORATE', 'Korporat']],
    CINEMA_LAYOUT_CATEGORY: [['ENTRANCE', 'Entrance'], ['LOBBY', 'Lobby'], ['TICKET_COUNTER', 'Ticket Counter'],
      ['CONCESSION', 'Concession / F&B'], ['WAITING_AREA', 'Waiting Area'], ['AUDITORIUM_ENTRANCE', 'Auditorium Entrance'],
      ['EXIT', 'Exit'], ['TOILET', 'Toilet'], ['EMERGENCY_EXIT', 'Emergency Exit'], ['PUBLIC_FACILITY', 'Public Facility']],
    MALL_LAYOUT_CATEGORY: [['MAIN_ENTRANCE', 'Main Entrance'], ['MALL_DIRECTORY', 'Mall Directory'], ['ESCALATOR', 'Escalator'],
      ['ELEVATOR', 'Elevator'], ['PARKING', 'Parking Area'], ['PUBLIC_TOILET', 'Public Toilet'],
      ['EMERGENCY_ACCESS', 'Emergency Access'], ['CINEMA_ACCESS', 'Cinema Access'], ['FOOD_COURT', 'Food Court'],
      ['PUBLIC_FACILITY', 'Public Facilities']],
    EDUCATION_CATEGORY: [['SERVICE_EXCELLENCE', 'Service Excellence'], ['CINEMA_OPERATION', 'Cinema Operation'],
      ['FNB_OPERATION', 'F&B Operation'], ['SAFETY_SECURITY', 'Safety & Security'], ['GUEST_HANDLING', 'Guest Handling'],
      ['SOP', 'SOP'], ['LEADERSHIP', 'Leadership'], ['PRODUCT_KNOWLEDGE', 'Product Knowledge'],
      ['INTERNAL_CONTROL', 'Internal Control'], ['TRAINING_DEVELOPMENT', 'Training & Development']],
    EDUCATION_FORMAT: [['ARTICLE', 'Artikel'], ['PDF', 'PDF'], ['PPT', 'PowerPoint'], ['VIDEO', 'Video'],
      ['IMAGE', 'Gambar'], ['LINK', 'Tautan']],
    PROBLEM_CATEGORY: [['PROJECTION', 'Projection'], ['SOUND_SYSTEM', 'Sound System'], ['TICKETING', 'Ticketing'],
      ['MTIX', 'M-Tix'], ['FNB', 'F&B'], ['BUILDING_MAINTENANCE', 'Building Maintenance'], ['ELECTRICAL', 'Electrical'],
      ['AIR_CONDITIONING', 'Air Conditioning'], ['CUSTOMER_COMPLAINT', 'Customer Complaint'],
      ['OPERATIONAL_PROCEDURE', 'Operational Procedure'], ['IT_SYSTEM', 'IT & System']],
    ANNOUNCEMENT_CATEGORY: [['GENERAL', 'Umum'], ['OPERATIONAL', 'Operasional'], ['HR', 'SDM'], ['POLICY', 'Kebijakan'],
      ['EVENT', 'Event'], ['SYSTEM', 'Sistem']],
    DEPARTMENT: [['OPERATIONS', 'Operasional'], ['FNB', 'F&B'], ['TICKETING', 'Ticketing'], ['TECHNICAL', 'Teknik'],
      ['MARKETING', 'Marketing'], ['HR', 'Human Resources'], ['FINANCE', 'Finance'], ['IT', 'IT']],
    POSITION: [['CINEMA_MANAGER', 'Cinema Manager'], ['ASSISTANT_MANAGER', 'Assistant Manager'],
      ['SUPERVISOR', 'Supervisor'], ['TECHNICIAN', 'Teknisi'], ['CREW', 'Crew'], ['STAFF', 'Staff']],
    EMPLOYMENT_STATUS: [['TETAP', 'Karyawan Tetap'], ['KONTRAK', 'Kontrak'], ['PROBATION', 'Probation'], ['MAGANG', 'Magang']]
  };

  function sys() {
    return { user: { user_id: CH.SYSTEM_ACTOR, username: 'system' } };
  }

  /** Menambahkan data referensi yang belum ada. Mengembalikan ringkasan. */
  function reference() {
    const ctx = sys();
    const summary = { roles: 0, permissions: 0, grants: 0, lookups: 0, config: 0 };

    const roles = Repo.table('ROLES');
    const roleRows = ROLES.filter((r) => !roles.findById(r[0])).map((r) => ({
      role_id: r[0], role_name: r[1], description: r[2], level: r[3], is_system: true, status: 'ACTIVE'
    }));
    roles.insertMany(roleRows, ctx);
    summary.roles = roleRows.length;

    const perms = Repo.table('PERMISSIONS');
    const newPerms = PERMISSIONS.filter((p) => !perms.findById(p[0]));
    perms.insertMany(newPerms.map((p) => ({
      permission_key: p[0], module: p[0].split('.')[0], action: p[0].split('.').slice(1).join('.'),
      description: p[1], is_sensitive: p[2], status: 'ACTIVE'
    })), ctx);
    summary.permissions = newPerms.length;

    // Grant default hanya untuk permission yang BARU ditambahkan (perubahan admin tetap dihormati)
    const rp = Repo.table('ROLE_PERMISSIONS');
    const existingGrants = {};
    rp.all().forEach((g) => { existingGrants[g.role_id + '|' + g.permission_key] = true; });
    const newKeys = {};
    newPerms.forEach((p) => { newKeys[p[0]] = true; });
    const grants = [];
    Object.keys(MATRIX).forEach((roleId) => {
      MATRIX[roleId].forEach((key) => {
        if (newKeys[key] && !existingGrants[roleId + '|' + key]) {
          grants.push({ role_id: roleId, permission_key: key, status: 'ACTIVE' });
        }
      });
    });
    rp.insertMany(grants, ctx);
    summary.grants = grants.length;

    const lookups = Repo.table('LOOKUPS');
    const existingLookups = {};
    lookups.all().forEach((l) => { existingLookups[l.type + '|' + l.code] = true; });
    const lookupRows = [];
    Object.keys(LOOKUPS).forEach((type) => {
      LOOKUPS[type].forEach((item, i) => {
        if (!existingLookups[type + '|' + item[0]]) {
          lookupRows.push({ type, code: item[0], label: item[1], sort_order: (i + 1) * 10, status: 'ACTIVE' });
        }
      });
    });
    lookups.insertMany(lookupRows, ctx);
    summary.lookups = lookupRows.length;

    const cfg = Repo.table('APP_CONFIG');
    const now = Utils.nowIso();
    const cfgRows = CH_CONFIG_DEFAULTS.filter((d) => !cfg.findById(d[0])).map((d) => ({
      config_key: d[0], config_value: d[1], value_type: d[2], description: d[3], is_public: d[4],
      updated_at: now, updated_by: CH.SYSTEM_ACTOR
    }));
    cfg.insertMany(cfgRows, ctx);
    summary.config = cfgRows.length;
    return summary;
  }

  return { reference, ROLES, PERMISSIONS, MATRIX, LOOKUPS, sys };
})();
