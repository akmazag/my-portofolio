/**
 * test-backend.js — Uji integrasi backend memakai data workbook asli.
 *   QC_DATA_JSON=/path/qcdata.json node tools/test-backend.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { createGas } = require('./gas-harness');

const data = JSON.parse(fs.readFileSync(process.env.QC_DATA_JSON, 'utf8'));
// Password asli TIDAK dipakai: seluruh password di salinan memori diganti nilai uji (plaintext → menguji migrasi hash).
const PW = process.env.QC_TEST_PW || 'uji-lokal-123';
(data.Users || data.USERS).forEach((r, i) => { if (i > 0 && r[0]) r[1] = PW; });

// ── Fixture diturunkan dari data (tidak ada nama/kredensial yang ditanam di kode uji) ──
const U = (data.Users || data.USERS); const UH = U[0].map(String);
const col = n => UH.indexOf(n);
const users = U.slice(1).filter(r => r[0]).map(r => ({ u: String(r[0]), role: String(r[col('Role')]).toLowerCase(), akses: String(r[col('AksesData')] || ''), nama: String(r[col('Nama')] || '') }));
const isAdm = r => ['qc', 'qc office', 'admin', 'admin qc office'].includes(r);
const ADMINS = users.filter(x => isAdm(x.role)).map(x => x.u);
const ADMIN = ADMINS.includes('admin') ? 'admin' : ADMINS[0];
const ADMIN2 = ADMINS.find(x => x !== ADMIN);
const ADMIN3 = ADMINS.find(x => x !== ADMIN && x !== ADMIN2) || ADMIN2;
const OUTLET_USER = users.find(x => x.role === 'outlet').u;
const QCA = users.find(x => x.role === 'qc area');
const QCA_AREAS = QCA.akses.split(',').map(t => t.split(':')[1]).filter(Boolean).map(t => t.trim()).sort();
const K = data.KODE; const KH = K[0].map(String); const kc = n => KH.indexOf(n);
const KODE = K.slice(1).filter(r => r[0]);
const QCA_COUNT = KODE.filter(r => QCA_AREAS.includes(String(r[kc('Area')]).trim())).length;
const kabagCnt = {}; KODE.forEach(r => { const k = String(r[kc('KabagQCArea')] || '').trim(); if (k) kabagCnt[k] = (kabagCnt[k] || 0) + 1; });
const KABAGS = Object.keys(kabagCnt).sort((a, b) => kabagCnt[b] - kabagCnt[a]);
const TOP_KABAG = KABAGS[0], OTHER_KABAG = KABAGS[1];
const rmCnt = {}; KODE.forEach(r => { const k = String(r[kc('RM')] || '').trim(); if (k) rmCnt[k] = (rmCnt[k] || 0) + 1; });
const TOP_RM = Object.keys(rmCnt).sort((a, b) => rmCnt[b] - rmCnt[a])[0];
const OP = data.OP; const OPH = OP[0].map(String);
const UNASSIGNED = OP.slice(1).map(r => String(r[OPH.indexOf('NAMA')]).trim()).find(n => n && !kabagCnt[n]);
let OWN_OUTLET = null;            // diisi setelah bootstrap outlet
const outsideCodes = n => KODE.filter(r => !QCA_AREAS.includes(String(r[kc('Area')]).trim()) && String(r[kc('NamaOutlet')]) !== OWN_OUTLET).slice(0, n).map(r => String(r[0]));
const outsideName = () => String(KODE.find(r => String(r[kc('NamaOutlet')]) !== OWN_OUTLET)[kc('NamaOutlet')]);
const LEGACY_ITEMS = (data['MASTER CHECK'] || []).slice(1).filter(r => r[1]).length;

const G = createGas(data, { now: '2026-11-08T10:00:00+07:00' });
let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); }
};
const ok = (res, label) => { if (!res || !res.ok) throw new Error((label || '') + ' → ' + JSON.stringify(res)); return res.data; };
const denied = (res) => { assert.strictEqual(res.ok, false, 'harus ditolak: ' + JSON.stringify(res).slice(0, 200)); return res; };
const login = (u, p) => ok(G.run('apiLogin', u, p), 'login ' + u).token;

console.log('\n[1] Setup database (non-destruktif)');
let setup;
T('setupDatabase berjalan', () => { setup = G.run('setupDatabase'); });
T('header Users tidak berubah & tidak menambah PasswordHash', () => {
  const h = G.sheet('Users').data[0].slice(0, 11);
  assert.deepStrictEqual(h, ['Username', 'Password', 'Role', 'Nama', 'AksesData', 'KodeOutlet', 'Status', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']);
  assert.ok(!G.sheet('Users').data[0].includes('PasswordHash'));
});
T('tidak membuat sheet USERS duplikat', () => assert.strictEqual(G.ss.sheets.filter(s => s.name.toLowerCase() === 'users').length, 1));
T('MASTER_CHECK terisi dari sheet lama + kolom Aspek', () => {
  assert.strictEqual(setup.masterCheckMigrated, LEGACY_ITEMS);
  assert.ok(G.sheet('MASTER_CHECK').data[0].includes('Aspek'));
});
T('kolom baru CHECKLIST_HEADER & AUDIT_LOG ditambahkan di kanan', () => {
  assert.ok(G.sheet('CHECKLIST_HEADER').data[0].includes('StatusDokumen'));
  assert.strictEqual(G.sheet('AUDIT_LOG').data[0][9], 'Role');
});
T('config baru di-seed (grading_method)', () => assert.ok(G.sheet('APP_CONFIG').data.some(r => r[0] === 'grading_method')));

console.log('\n[2] Autentikasi & keamanan');
let tAdmin, tOutlet, tQcArea, tKus;
T('login admin (password plaintext lama) berhasil', () => { tAdmin = login(ADMIN, PW); });
T('password admin dimigrasikan menjadi hash bersalt', () => {
  const row = G.sheet('Users').data.find(r => r[0] === ADMIN);
  assert.ok(/^sha256\$\d+\$/.test(row[1]), row[1]);
});
T('login ulang admin dengan hash baru', () => { tAdmin = login(ADMIN, PW); });
T('password salah ditolak dengan pesan generik', () => {
  const r = G.run('apiLogin', ADMIN, 'salah'); assert.strictEqual(r.ok, false); assert.ok(/salah/.test(r.msg));
});
T('user tak dikenal ditolak', () => denied(G.run('apiLogin', 'tidakada', 'x')));
T('login admin lain, user Outlet, user QC Area', () => {
  tKus = login(ADMIN3, PW); tOutlet = login(OUTLET_USER, PW); tQcArea = login(QCA.u, PW);
});
T('rate limit: 5x gagal → terkunci', () => {
  for (let i = 0; i < 5; i++) G.run('apiLogin', ADMIN2, 'x');
  const r = G.run('apiLogin', ADMIN2, PW); assert.strictEqual(r.ok, false); assert.ok(/Terlalu banyak/.test(r.msg));
});
T('token palsu ditolak', () => { const r = G.run('apiBootstrap', 'palsu'); assert.strictEqual(r.code, 'SESSION_EXPIRED'); });

console.log('\n[3] Scope');
let bAdmin, bOutlet, bQc;
T('admin melihat seluruh outlet', () => { bAdmin = ok(G.run('apiBootstrap', tAdmin)); assert.strictEqual(bAdmin.outlets.length, KODE.length); assert.ok(bAdmin.perms.isAdmin); });
T('user Outlet hanya 1 outlet miliknya', () => {
  bOutlet = ok(G.run('apiBootstrap', tOutlet));
  assert.strictEqual(bOutlet.outlets.length, 1); OWN_OUTLET = bOutlet.outlets[0].nama;
});
T('QC Area = token AREA di AksesData', () => {
  bQc = ok(G.run('apiBootstrap', tQcArea));
  const areas = [...new Set(bQc.outlets.map(o => o.area))].sort();
  assert.deepStrictEqual(areas, QCA_AREAS);
  assert.strictEqual(bQc.outlets.length, QCA_COUNT);
});
T('Outlet tidak bisa membaca checklist item outlet lain', () => denied(G.run('apiChecklistItems', tOutlet, outsideName(), ['Cinema'])));

console.log('\n[4] Cleaning');
let cl;
T('apiCleaning view=all (admin)', () => { cl = ok(G.run('apiCleaning', tAdmin, { view: 'all', orDate: '2026-11-08' })); });
T('Class A tanpa interval → No Interval, bukan OK', () => {
  const a = cl.rows.filter(r => r.kelas === 'A' && r.terakhir !== '-');
  assert.ok(a.length > 0); assert.ok(a.every(r => r.status === 'No Interval'), JSON.stringify(a[0]));
});
T('Class B kursi (nilai INTERVAL berupa tanggal) → No Interval', () => {
  const b = cl.rows.filter(r => r.kelas === 'B' && r.jenis === 'Cuci Kursi' && r.terakhir !== '-');
  assert.ok(b.length > 0 && b.every(r => r.status === 'No Interval'));
});
T('Class C memakai interval 4 bln kursi', () => {
  const c = cl.rows.find(r => r.kelas === 'C' && r.jenis === 'Cuci Kursi' && r.terakhir !== '-');
  if (c) assert.strictEqual(c.interval, 4);
});
T('jenis "Kursi"/"Karpet" dinormalisasi', () => assert.ok(cl.events.every(e => ['Cuci Kursi', 'Cuci Karpet'].includes(e.jenis))));
T('summary konsisten (jumlah = total outlet)', () => {
  const s = cl.summary; assert.strictEqual(s.statusOK + s.statusWarning + s.statusOverdue + s.noHistory + s.noInterval, s.totalOutlet);
});
T('Outlet input cleaning outlet sendiri', () => ok(G.run('apiSaveCleaning', tOutlet, { outlet: OWN_OUTLET, tanggal: '2026-11-08', studio: 'Studio 2', jenis: 'Cuci Kursi' })));
T('duplikat ditolak', () => denied(G.run('apiSaveCleaning', tOutlet, { outlet: OWN_OUTLET, tanggal: '2026-11-08', studio: 'Studio 2', jenis: 'Kursi' })));
T('Outlet input untuk outlet lain ditolak', () => denied(G.run('apiSaveCleaning', tOutlet, { outlet: outsideName(), tanggal: '2026-11-08', studio: 'Studio 2', jenis: 'Cuci Kursi' })));
T('tanggal masa depan ditolak', () => denied(G.run('apiSaveCleaning', tAdmin, { outlet: outsideCodes(1)[0], tanggal: '2026-12-08', studio: 'Studio 2', jenis: 'Cuci Kursi' })));
T('cache cleaning ter-refresh setelah input', () => {
  const c2 = ok(G.run('apiCleaning', tAdmin, { view: 'calendar' }));
  assert.ok(c2.events.some(e => e.outlet === OWN_OUTLET && e.tanggal === '2026-11-08'));
});
T('Outlet tidak boleh hapus transaksi', () => denied(G.run('apiDeleteCleaning', tOutlet, cl.events[0].idCleaning)));

console.log('\n[5] Visit → Checklist → Grading');
let opts, vId;
T('form options QC Area hanya dirinya', () => {
  opts = ok(G.run('apiVisitFormOptions', tQcArea));
  assert.strictEqual(opts.qcAreas.length, 1); assert.ok(opts.qcAreas[0].outlets.length > 0);
});
const target = () => opts.outlets.find(o => o.area === QCA_AREAS[0]);
T('QC Area membuat jadwal di scope', () => {
  const r = ok(G.run('apiCreateVisit', tQcArea, { tanggalRencana: '2026-11-09', kodeOutlet: target().kode, keterangan: 'uji' }));
  vId = r.idVisit;
});
T('jadwal duplikat tanggal sama ditolak', () => denied(G.run('apiCreateVisit', tQcArea, { tanggalRencana: '2026-11-09', kodeOutlet: target().kode })));
T('QC Area tidak bisa jadwalkan atas nama orang lain', () => denied(G.run('apiCreateVisit', tQcArea, { tanggalRencana: '2026-11-10', kodeOutlet: target().kode, namaQCArea: OTHER_KABAG })));
T('QC Area tidak bisa jadwalkan outlet luar scope', () => denied(G.run('apiCreateVisit', tQcArea, { tanggalRencana: '2026-11-10', kodeOutlet: outsideCodes(1)[0] })));
T('Completed manual ditolak (harus lewat checklist)', () => denied(G.run('apiUpdateVisitStatus', tQcArea, vId, 'Completed')));
T('mulai kunjungan (In Progress)', () => ok(G.run('apiUpdateVisitStatus', tQcArea, vId, 'In Progress', 'mulai')));
let items;
T('item Cinema + F&B (kategori "FnB" dinormalisasi)', () => {
  const r = ok(G.run('apiChecklistItems', tQcArea, target().nama, ['Cinema', 'FnB']));
  items = r.items; assert.ok(items.some(i => i.kategori === 'F&B') && items.some(i => i.kategori === 'Cinema'));
  assert.ok(!items.some(i => i.kategori === 'Premiere'));
});
T('skor di luar 1–5 ditolak', () => denied(G.run('apiSubmitChecklist', tQcArea, { idVisit: vId, tanggal: '2026-11-08',
  items: items.map(i => ({ idItem: i.idCheck, score: 6 })) })));
let sub;
T('submit checklist + PDF valid', () => {
  const pdf = Buffer.from('%PDF-1.4\n%test\n').toString('base64');
  sub = ok(G.run('apiSubmitChecklist', tQcArea, { idVisit: vId, tanggal: '2026-11-08',
    items: items.map((i, k) => (k === 0 ? { idItem: i.idCheck, isNA: true } : { idItem: i.idCheck, score: k % 2 ? 4 : 5 })),
    pdf: { name: 'ba.pdf', base64: pdf } }));
  assert.strictEqual(sub.statusDokumen, 'Uploaded');
  const expectMax = (items.length - 1) * 5; assert.strictEqual(sub.totalScoreMax, expectMax);
});
T('FileDocumentID tersimpan (bug v1)', () => {
  const h = G.sheet('CHECKLIST_HEADER'); const i = h.data[0].indexOf('FileDocumentID');
  assert.ok(String(h.data[h.data.length - 1][i]).length > 10);
});
T('PDF tidak dibagikan publik', () => assert.ok([...G.drive.values()].filter(f => f.id).every(f => f.sharing === 'PRIVATE')));
T('visit otomatis Completed', () => { const d = ok(G.run('apiGetVisitDetail', tQcArea, vId)); assert.strictEqual(d.visit.status, 'Completed'); assert.ok(d.checklist); });
T('submit kedua ditolak', () => denied(G.run('apiSubmitChecklist', tQcArea, { idVisit: vId, tanggal: '2026-11-08', items: items.map(i => ({ idItem: i.idCheck, score: 3 })) })));
T('dokumen dapat dibuka QC Area, ditolak untuk Outlet lain', () => {
  const det = ok(G.run('apiGetChecklistDetail', tQcArea, sub.idChecklist));
  ok(G.run('apiGetDocumentFile', tQcArea, det.dokumen.idDocument));
  denied(G.run('apiGetDocumentFile', tOutlet, det.dokumen.idDocument));
});
T('upload bukan PDF ditolak', () => denied(G.run('apiUploadChecklistPDF', tQcArea, sub.idChecklist, { name: 'x.pdf', base64: Buffer.from('hello').toString('base64') })));
let gr;
T('grading ratio Σ/Σ', () => {
  gr = ok(G.run('apiGrading', tAdmin, {}));
  assert.strictEqual(gr.summary.total, 1);
  assert.strictEqual(gr.rows[0].gradePercent, Math.round(sub.totalScoreAktual / sub.totalScoreMax * 1000) / 10);
  assert.ok(gr.byQCArea[0].visitAchievement >= 0);
});
T('grading detail QC Area (bug v1: visit kosong)', () => {
  const d = ok(G.run('apiGradingDetail', tAdmin, TOP_KABAG));
  assert.ok(d.kpi.completedVisit >= 1, JSON.stringify(d.kpi));
});
T('Outlet tidak melihat checklist outlet lain di grading', () => assert.strictEqual(ok(G.run('apiGrading', tOutlet, {})).summary.total, 0));
T('visit coverage 3 bulan menghitung outlet unik', () => {
  const c = ok(G.run('apiVisitCoverage', tQcArea, { bulan: 11, tahun: 2026, periode: 3 }));
  assert.strictEqual(c.outletVisited, 1); assert.strictEqual(c.totalOutletScope, QCA_COUNT);
});

console.log('\n[6] Dashboard, organisasi, admin');
T('dashboard admin (bug v1: round_ undefined)', () => {
  const d = ok(G.run('apiDashboard', tAdmin));
  assert.strictEqual(d.totalOutlet, KODE.length); assert.ok(d.recentActivity.length > 0); assert.ok(d.checklistCompleted >= 1);
});
T('dashboard outlet tidak menampilkan audit trail user lain', () => {
  const d = ok(G.run('apiDashboard', tOutlet));
  assert.ok(d.recentActivity.every(a => a.user === OUTLET_USER || a.user === ''), JSON.stringify(d.recentActivity.slice(0, 2)));
});
let map;
T('mapping organisasi menampilkan seluruh personel OP QC Area', () => {
  map = ok(G.run('apiMapping', tAdmin));
  assert.ok(map.kabag.length >= OP.length - 1, map.kabag.length);
  const w = map.kabag.find(k => k.nama === TOP_KABAG); assert.strictEqual(w.outletCount, kabagCnt[TOP_KABAG]);
});
T('detail personel memakai field kode/nama', () => {
  const p = ok(G.run('apiGetPersonnel', tAdmin, TOP_KABAG)); assert.ok(p.outlets[0].kode && p.outlets[0].nama);
});
T('update penugasan personel tanpa outlet → 2 outlet', () => {
  const r = ok(G.run('apiUpdatePersonnel', tAdmin, { nama: UNASSIGNED, jabatan: 'QC Area', outlets: outsideCodes(2) }));
  assert.strictEqual(r.updated, 2);
  const p = ok(G.run('apiGetPersonnel', tAdmin, UNASSIGNED)); assert.strictEqual(p.outlets.length, 2);
});
T('QC Office tidak boleh outlet cinema', () => denied(G.run('apiUpdatePersonnel', tAdmin, { nama: UNASSIGNED, jabatan: 'QC Office', outlets: outsideCodes(1) })));
T('non-admin tidak bisa kelola user', () => denied(G.run('apiGetUsers', tQcArea)));
T('nonaktifkan user → sesinya langsung dicabut', () => {
  ok(G.run('apiToggleUserStatus', tAdmin, OUTLET_USER));
  assert.strictEqual(G.run('apiBootstrap', tOutlet).code, 'SESSION_EXPIRED');
  ok(G.run('apiToggleUserStatus', tAdmin, OUTLET_USER));
});
T('AksesData tidak valid ditolak', () => denied(G.run('apiSaveUser', tAdmin, { username: 'tes.rm', nama: 'Tes', role: 'RM', password: 'rahasia1', aksesData: 'AREA:TIDAK ADA' })));
T('tambah user RM (scope via kolom RM)', () => {
  ok(G.run('apiSaveUser', tAdmin, { username: 'uji.rm', nama: TOP_RM, role: 'RM', password: 'rahasia1' }));
  const b = ok(G.run('apiBootstrap', login('uji.rm', 'rahasia1'))); assert.strictEqual(b.outlets.length, rmCnt[TOP_RM]);
});
T('config grading_method divalidasi', () => denied(G.run('apiUpdateAppConfig', tAdmin, { key: 'grading_method', value: 'asal' })));
let audit;
T('audit data menghasilkan temuan', () => { audit = ok(G.run('apiAuditDatabase', tAdmin)).findings; assert.ok(audit.length > 0); });
T('kinerja: jumlah pembacaan sheet wajar', () => assert.ok(G.ss.stats.reads < 5000, G.ss.stats.reads));

console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
if (process.env.AUDIT_OUT) fs.writeFileSync(process.env.AUDIT_OUT, JSON.stringify(audit, null, 2));
process.exit(fail ? 1 : 0);
