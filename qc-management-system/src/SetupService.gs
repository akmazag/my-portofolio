/**
 * SetupService.gs
 * Setup database NON-DESTRUKTIF, audit kualitas data, dan utilitas admin.
 * @version 2.0.0
 *
 * Prinsip (PRD §15): tidak mengubah struktur / data existing tanpa persetujuan.
 *  - Sheet yang sudah ada TIDAK ditimpa headernya; kolom yang belum ada hanya ditambah di kanan.
 *  - Tidak ada seed data demo bila sheet sudah berisi data.
 *  - Normalisasi data hanya lewat menu eksplisit + tercatat di AUDIT_LOG.
 *
 * Catatan: fungsi yang dipanggil dari menu TIDAK boleh berakhiran "_" (fungsi privat
 * Apps Script tidak dapat dipanggil dari menu — bug v1 "Script function not found").
 */

function _ui_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }
function _alert_(msg) { const ui = _ui_(); if (ui) { try { ui.alert(msg); } catch (e) {} } Logger.log(msg); }

// ─── Menu ─────────────────────────────────────────────────────────────────────

function onOpen() {
  const ui = _ui_();
  if (!ui) return;
  ui.createMenu('⚙️ QC Admin')
    .addItem('1. Setup / Perbaiki Struktur Database', 'setupDatabase')
    .addItem('2. Audit Kualitas Data', 'auditDatabase')
    .addSeparator()
    .addItem('Migrasi Master Checklist (MASTER CHECK → MASTER_CHECK)', 'migrateMasterCheckLegacy')
    .addItem('Hash Seluruh Password Plaintext', 'hashPlaintextPasswords')
    .addItem('Reset Password Admin…', 'resetAdminPassword')
    .addItem('Cabut Akses Publik File PDF Lama', 'revokePublicSharing')
    .addSeparator()
    .addItem('Siapkan Folder PDF di Drive', 'setupPdfFolder')
    .addItem('Reset Cache Aplikasi', 'clearAppCache')
    .addItem('Tentang Aplikasi', 'showAbout')
    .addToUi();
}

function setupDatabaseUi() { return setupDatabase(); }

function showAbout() {
  _alert_('QC Management System v' + APP_VERSION + '\nGoogle Apps Script + Google Sheets\n' +
          'Role-Based Access Control • Scope-Based Data • Booster Cache');
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Pastikan seluruh sheet & kolom schema tersedia (tanpa menimpa data).
 * @returns {Object} ringkasan perubahan
 */
function setupDatabase() {
  const ss = getSS_();
  const report = { dibuat: [], kolomDitambah: {} };
  Object.keys(SCHEMA).forEach(name => {
    const r = ensureSheet_(ss, name);
    if (r.created) report.dibuat.push(name);
    if (r.added.length) report.kolomDitambah[name] = r.added;
  });
  _seedAppConfig_();
  const admin = _seedFirstAdmin_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  try { getPdfFolder_(); } catch (e) { Logger.log('[setupDatabase] folder PDF: ' + e.message); }
  let migrated = 0;
  try { migrated = migrateMasterCheckLegacy_(null); } catch (e) { Logger.log('[setupDatabase] master check: ' + e.message); }
  bumpVersion_.apply(null, DATA_MODULES);

  const lines = ['✅ Setup database selesai (non-destruktif).',
    'Sheet baru: ' + (report.dibuat.join(', ') || '-'),
    'Kolom ditambahkan: ' + (Object.keys(report.kolomDitambah).map(k => k + ' [' + report.kolomDitambah[k].join(', ') + ']').join('; ') || '-'),
    'Master checklist disalin dari sheet lama: ' + migrated + ' item'];
  if (admin) lines.push('', '⚠️ Akun admin pertama dibuat → username: ' + admin.username + ' | password: ' + admin.password +
                        '\nSegera ganti password setelah login.');
  lines.push('', 'Langkah berikutnya: jalankan "Audit Kualitas Data".');
  _alert_(lines.join('\n'));
  report.masterCheckMigrated = migrated;
  return report;
}

/**
 * Buat sheet bila belum ada; bila ada, tambahkan kolom schema yang belum tersedia.
 * @returns {{sheet, created: boolean, added: string[]}}
 */
function ensureSheet_(ss, name) {
  _EXEC.ss = ss;
  let sheet = findSheet_(name);
  const schema = SCHEMA[name];
  let created = false, added = [];
  if (!sheet) {
    sheet = ss.insertSheet(name);
    _EXEC.sheets[_sheetKey_(name)] = sheet;
    created = true;
  }
  if (sheet.getLastColumn() < 1 || sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, schema.length).setValues([schema]);
    try {
      sheet.getRange(1, 1, 1, schema.length).setBackground('#172554').setFontColor('#FFFFFF').setFontWeight('bold');
      sheet.setFrozenRows(1);
    } catch (e) {}
    added = schema.slice();
  } else {
    const before = sheet.getLastColumn();
    const headers = getSheetHeaders_(sheet, schema);
    added = headers.slice(before);
  }
  _execInvalidate_(name);
  return { sheet: sheet, created: created, added: created ? [] : added };
}

function _seedAppConfig_() {
  const have = {};
  readColumns_('APP_CONFIG', ['ConfigKey']).forEach(r => { have[String(r.ConfigKey).trim()] = true; });
  const now = fmtDateTime_(new Date());
  const rows = DEFAULT_CONFIG.filter(c => !have[c[0]]).map(c => ({ ConfigKey: c[0], ConfigValue: c[1], Deskripsi: c[2], UpdatedAt: now, UpdatedBy: 'SYSTEM' }));
  if (rows.length) appendRows_('APP_CONFIG', rows);
  // Sinkronkan versi aplikasi
  const v = readTable_('APP_CONFIG').find(r => String(r['ConfigKey']) === 'app_version');
  if (v && String(v['ConfigValue']) !== APP_VERSION) updateRow_('APP_CONFIG', v.__rowIndex, { ConfigValue: APP_VERSION, UpdatedAt: now, UpdatedBy: 'SYSTEM' });
}

/** Hanya bila sheet USERS kosong: buat 1 admin dengan password acak. */
function _seedFirstAdmin_() {
  if (readTable_('USERS').length) return null;
  const pass = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  appendRow_('USERS', { Username: 'admin', Password: hashPassword_(pass), Nama: 'Administrator QC', Role: ROLES.QC,
                        AksesData: 'ALL', KodeOutlet: '', Status: 'Active', CreatedBy: 'SYSTEM', UpdatedBy: 'SYSTEM' });
  return { username: 'admin', password: pass };
}

// ─── Utilitas keamanan ────────────────────────────────────────────────────────

/** Ubah semua password plaintext / SHA-256 tanpa salt menjadi hash bersalt. */
function hashPlaintextPasswords() {
  const n = withLock_(() => {
    let c = 0;
    readTable_('USERS').forEach(r => {
      const stored = _storedPassword_(r);
      if (!stored) return;
      if (/^sha256\$/.test(stored)) return;
      if (/^[a-f0-9]{64}$/i.test(stored)) return;   // hash v1 dimigrasi saat login (plaintext tidak diketahui)
      updateRow_('USERS', r.__rowIndex, { Password: hashPassword_(stored), UpdatedBy: 'SYSTEM' });
      c++;
    });
    return c;
  }, 30000);
  bumpVersion_('users');
  auditLog_(null, 'HASH_PASSWORDS', 'USERS', '', null, { jumlah: n });
  _alert_('🔐 ' + n + ' password plaintext telah di-hash. User tetap login dengan password yang sama.');
  return n;
}

/** Reset password akun admin melalui dialog (tidak ada password default yang ditanam di kode). */
function resetAdminPassword() {
  const ui = _ui_();
  if (!ui) throw new Error('Jalankan dari menu spreadsheet.');
  const r1 = ui.prompt('Reset Password Admin', 'Username admin:', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const uname = String(r1.getResponseText()).trim();
  const r2 = ui.prompt('Reset Password Admin', 'Password baru untuk "' + uname + '" (min. 8 karakter):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const pass = String(r2.getResponseText());
  if (pass.length < 8) { ui.alert('Password minimal 8 karakter.'); return; }
  const row = readTable_('USERS').find(r => norm_(r['Username']) === norm_(uname));
  if (!row) { ui.alert('User tidak ditemukan.'); return; }
  if (!isAdminRole_(row['Role'])) { ui.alert('User tersebut bukan admin (role: ' + row['Role'] + ').'); return; }
  updateRow_('USERS', row.__rowIndex, { Password: hashPassword_(pass), Status: 'Active', UpdatedBy: 'SYSTEM' });
  bumpVersion_('users');
  clearLoginFail_(uname);
  auditLog_(null, 'RESET_ADMIN_PASSWORD', 'USERS', uname, null, null);
  ui.alert('✅ Password admin "' + uname + '" berhasil direset.');
}

/** File PDF v1 dibagikan "Anyone with link" — cabut agar hanya lewat aplikasi. */
function revokePublicSharing() {
  let n = 0, fail = 0;
  readColumns_('FILE_DOCUMENT', ['DriveFileID']).forEach(d => {
    try {
      const f = DriveApp.getFileById(String(d.DriveFileID));
      if (f.getSharingAccess() !== DriveApp.Access.PRIVATE) { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); n++; }
    } catch (e) { fail++; }
  });
  _alert_('🔒 Akses publik dicabut dari ' + n + ' file' + (fail ? ' (' + fail + ' file gagal/tidak ditemukan)' : '') + '.');
  return n;
}

// ─── Audit Kualitas Data ──────────────────────────────────────────────────────

/**
 * Periksa konsistensi data seluruh sheet. Tidak mengubah data.
 * @returns {Array<Object>} temuan {tingkat, sheet, baris, masalah, saran}
 */
function runDataAudit_() {
  const F = [];
  const add = (tingkat, sheet, baris, masalah, saran) => F.push({ tingkat: tingkat, sheet: sheet, baris: baris || '', masalah: masalah, saran: saran || '' });
  const m = getMasterCache_();
  const ivMap = getIntervalMap_();

  // KODE
  const seenK = {}, seenN = {};
  m.kode.forEach(r => {
    const k = norm_(r.KodeOutlet), n = norm_(r.NamaOutlet);
    if (!k) add('KRITIS', 'KODE', r.__rowIndex, 'Kode outlet kosong untuk "' + r.NamaOutlet + '"', 'Isi KodeOutlet (identitas relasi).');
    if (k && seenK[k]) add('KRITIS', 'KODE', r.__rowIndex, 'Kode outlet duplikat: ' + r.KodeOutlet, 'Kode outlet harus unik.');
    if (n && seenN[n]) add('TINGGI', 'KODE', r.__rowIndex, 'Nama outlet duplikat: ' + r.NamaOutlet, 'Bedakan nama outlet.');
    seenK[k] = 1; seenN[n] = 1;
    if (!String(r.Class || '').trim()) add('TINGGI', 'KODE', r.__rowIndex, r.KodeOutlet + ' belum memiliki Class', 'Isi Class agar interval cleaning dapat dihitung.');
    if (!String(r.Area || '').trim() || !String(r.RM || '').trim()) add('SEDANG', 'KODE', r.__rowIndex, r.KodeOutlet + ' belum lengkap Area/RM', 'Lengkapi untuk scope RM/Area.');
  });
  const tanpaKabag = m.kode.filter(r => !String(r.KabagQCArea || '').trim()).length;
  if (tanpaKabag) add('TINGGI', 'KODE', '', tanpaKabag + ' dari ' + m.kode.length + ' outlet belum memiliki KabagQCArea',
                      'Outlet tanpa Kabag tidak masuk scope QC Area mana pun & tidak masuk target kunjungan per personel.');

  // INTERVAL
  const kelasKode = [...new Set(m.kode.map(r => String(r.Class || '').trim()).filter(Boolean))];
  const seenC = {};
  m.interval.forEach(iv => {
    const c = String(iv.Class || '').trim();
    if (!c) return;
    if (seenC[norm_(c)]) add('SEDANG', 'INTERVAL', iv.__rowIndex, 'Class "' + c + '" duplikat (baris pertama yang dipakai)', 'Hapus baris duplikat.');
    seenC[norm_(c)] = 1;
    if (!toPositiveNumber_(iv.BulanCuciKursi)) add('KRITIS', 'INTERVAL', iv.__rowIndex, 'BulanCuciKursi class "' + c + '" tidak valid: "' + iv.BulanCuciKursi + '"', 'Isi angka bulan (mis. 4). Format sel harus Number, bukan Date.');
    if (!toPositiveNumber_(iv.BulanCuciKarpet)) add('KRITIS', 'INTERVAL', iv.__rowIndex, 'BulanCuciKarpet class "' + c + '" tidak valid: "' + iv.BulanCuciKarpet + '"', 'Isi angka bulan.');
  });
  kelasKode.forEach(c => {
    if (!ivMap[norm_(c)]) {
      const n = m.kode.filter(r => norm_(r.Class) === norm_(c)).length;
      add('KRITIS', 'INTERVAL', '', 'Class "' + c + '" (' + n + ' outlet) belum ada di sheet INTERVAL', 'Tambahkan baris interval untuk Class ' + c + '. Status cleaning outlet ini = "No Interval".');
    }
  });

  // USERS
  const seenU = {};
  readTable_('USERS').forEach(r => {
    const un = String(r['Username'] || '').trim();
    if (!un) return;
    if (seenU[norm_(un)]) add('KRITIS', 'USERS', r.__rowIndex, 'Username duplikat: ' + un, 'Username harus unik.');
    seenU[norm_(un)] = 1;
    const pw = _storedPassword_(r);
    if (pw && !isHashedPassword_(pw)) add('KRITIS', 'USERS', r.__rowIndex, 'Password "' + un + '" masih plaintext', 'Jalankan menu "Hash Seluruh Password Plaintext".');
    const role = canonRole_(r['Role']);
    if (!role) { add('KRITIS', 'USERS', r.__rowIndex, 'Role "' + r['Role'] + '" (' + un + ') tidak dikenali — user tidak bisa login', 'Gunakan: QC, RM, AM, Outlet, QC Area, Specialist.'); return; }
    if (norm_(r['Status']) === 'inactive') return;
    if (!String(r['Nama'] || '').trim()) add('RENDAH', 'USERS', r.__rowIndex, 'Nama user "' + un + '" kosong', 'Isi Nama (dipakai untuk pencocokan scope RM/AM/QC Area).');
    if (role !== ROLES.QC) {
      const codes = resolveScopeCodes_({ username: un, nama: String(r['Nama'] || ''), role: role,
        aksesData: String(r['AksesData'] || ''), kodeOutlet: String(r['KodeOutlet'] || '') }).codes;
      if (!codes.length) add('TINGGI', 'USERS', r.__rowIndex, 'User "' + un + '" (' + role + ') tidak memiliki outlet dalam scope', 'Periksa Nama/KodeOutlet/AksesData. Akses data ditolak sampai mapping benar.');
    }
  });

  // TRANSAKSI_CLEANING
  const rawCl = readColumns_('TRANSAKSI_CLEANING', ['KodeOutlet', 'NamaOutlet', 'JenisCleaning', 'Tanggal', 'Status']);
  let clNoOutlet = 0, clNoJenis = 0, clNoDate = 0, clJenisVar = {};
  rawCl.forEach(t => {
    if (norm_(t.Status) === 'deleted') return;
    if (!findOutlet_(t.KodeOutlet, t.NamaOutlet)) clNoOutlet++;
    const j = _normalizeJenis(t.JenisCleaning);
    if (!j) clNoJenis++; else clJenisVar[String(t.JenisCleaning)] = 1;
    if (!toDate_(t.Tanggal)) clNoDate++;
  });
  if (clNoOutlet) add('TINGGI', 'TRANSAKSI_CLEANING', '', clNoOutlet + ' transaksi tidak cocok dengan outlet di KODE', 'Perbaiki KodeOutlet / NamaOutlet.');
  if (clNoJenis) add('TINGGI', 'TRANSAKSI_CLEANING', '', clNoJenis + ' transaksi dengan JenisCleaning tidak dikenali', 'Gunakan "Cuci Kursi" / "Cuci Karpet".');
  if (clNoDate) add('TINGGI', 'TRANSAKSI_CLEANING', '', clNoDate + ' transaksi tanpa tanggal valid', 'Isi Tanggal.');
  if (Object.keys(clJenisVar).length > 2) add('RENDAH', 'TRANSAKSI_CLEANING', '', 'Variasi penulisan jenis: ' + Object.keys(clJenisVar).join(', '), 'Sudah dinormalisasi otomatis oleh sistem; seragamkan untuk input baru.');

  // LOG_VISIT
  const vNo = getVisits_().filter(v => !findOutlet_(v._kode, v._nama)).length;
  if (vNo) add('TINGGI', 'LOG_VISIT', '', vNo + ' kunjungan tidak cocok dengan outlet di KODE', 'Perbaiki KodeOutlet.');

  // MASTER_CHECK
  let mcRows = 0;
  try { mcRows = readTable_('MASTER_CHECK').length; } catch (e) {}
  if (!mcRows) {
    const leg = _readLegacyMasterCheck_().length;
    add(leg ? 'SEDANG' : 'KRITIS', 'MASTER_CHECK', '', 'Sheet MASTER_CHECK kosong' + (leg ? ' (sistem memakai ' + leg + ' item dari sheet lama "MASTER CHECK")' : ''),
        leg ? 'Jalankan menu "Migrasi Master Checklist" agar item dapat dikelola dari aplikasi.' : 'Isi item checklist.');
  }

  // OP / roster
  const roster = Object.values(getQcAreaRoster_());
  const noOutlet = roster.filter(p => !p.outlets.length).map(p => p.nama);
  if (noOutlet.length) add('SEDANG', 'OP', '', noOutlet.length + ' personel QC Area belum memiliki outlet: ' + noOutlet.slice(0, 15).join(', ') + (noOutlet.length > 15 ? ', …' : ''),
                           'Tetapkan outlet melalui menu Organisasi → Detail → Edit (mengisi KODE.KabagQCArea).');
  const noAccount = roster.filter(p => p.outlets.length && p.sources.indexOf('USERS') < 0).map(p => p.nama);
  if (noAccount.length) add('RENDAH', 'USERS', '', 'QC Area dengan outlet tetapi belum memiliki akun login: ' + noAccount.join(', '), 'Buat akun role "QC Area" dengan Nama yang sama.');

  const rank = { KRITIS: 0, TINGGI: 1, SEDANG: 2, RENDAH: 3 };
  return F.sort((a, b) => rank[a.tingkat] - rank[b.tingkat]);
}

/** Menu: tulis hasil audit ke sheet AUDIT_DATA. */
function auditDatabase() {
  const F = runDataAudit_();
  const ss = getSS_();
  let sh = ss.getSheetByName('AUDIT_DATA');
  if (!sh) sh = ss.insertSheet('AUDIT_DATA');
  sh.clear();
  const rows = [['Tingkat', 'Sheet', 'Baris', 'Masalah', 'Saran', 'Diperiksa']].concat(
    F.map(f => [f.tingkat, f.sheet, f.baris, f.masalah, f.saran, fmtDateTime_(new Date())]));
  sh.getRange(1, 1, rows.length, 6).setValues(rows);
  try { sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#172554').setFontColor('#FFFFFF'); sh.setFrozenRows(1); } catch (e) {}
  const cnt = {};
  F.forEach(f => { cnt[f.tingkat] = (cnt[f.tingkat] || 0) + 1; });
  _alert_('🔎 Audit data selesai: ' + F.length + ' temuan\n' + Object.keys(cnt).map(k => k + ': ' + cnt[k]).join(' | ') + '\nLihat sheet AUDIT_DATA.');
  return F;
}

/** API (Admin): hasil audit untuk ditampilkan di menu Pengaturan. */
function apiAuditDatabase(token) {
  return run_(token, function (u) {
    requireAdmin_(u);
    return { findings: runDataAudit_(), checkedAt: fmtDateTime_(new Date()) };
  });
}
