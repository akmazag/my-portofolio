/**
 * e2e-ui.js — Uji end-to-end UI di Chromium dengan backend mock (gas-harness).
 * google.script.run di browser dijembatani ke backend Node melalui page.exposeFunction.
 *
 *   QC_DATA_JSON=/path/qcdata.json OUT_DIR=/tmp/shots node tools/e2e-ui.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createGas } = require('./gas-harness');

const SRC = path.join(__dirname, '..', 'src');
const OUT = process.env.OUT_DIR || '/tmp';

function buildPage() {
  const inc = name => fs.readFileSync(path.join(SRC, name + '.html'), 'utf8')
    .replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, n) => inc(n));
  const stub = `<script>
    function __runner(s, f) {
      return new Proxy({}, { get(_, p) {
        if (p === 'withSuccessHandler') return h => __runner(h, f);
        if (p === 'withFailureHandler') return h => __runner(s, h);
        return (...a) => { window.__gas(p, JSON.stringify(a)).then(r => s && s(JSON.parse(r))).catch(e => f && f(e)); };
      } });
    }
    window.google = { script: { get run() { return __runner(null, null); } } };
  </script>`;
  return inc('Index').replace('<head>', '<head>' + stub);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(process.env.QC_DATA_JSON, 'utf8'));
  const PW = process.env.QC_TEST_PW || 'uji-lokal-123';
  (data.Users || data.USERS).forEach((r, i) => { if (i > 0 && r[0]) r[1] = PW; });
  const U = (data.Users || data.USERS), ri = U[0].indexOf('Role');
  const byRole = re => (U.slice(1).find(r => r[0] && re.test(String(r[ri]))) || [])[0];
  const ADMIN = U.slice(1).some(r => r[0] === 'admin') ? 'admin' : byRole(/^(qc|qc office|admin)/i);
  const QCA = byRole(/^qc area$/i), OUTLET = byRole(/^outlet$/i);
  const G = createGas(data, { now: '2026-11-08T10:00:00+07:00' });
  G.run('setupDatabase');
  const html = buildPage();
  const file = path.join(OUT, 'qc-e2e.html');
  fs.writeFileSync(file, html);

  const browser = await chromium.launch();
  const errors = [];
  const results = [];
  const check = (name, cond, extra) => { results.push([cond ? '✓' : '✗', name, extra || '']); };

  async function newPage(viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
    // CDN lokal (opsional): CDN_DIR = folder node_modules berisi bootstrap & chart.js
    if (process.env.CDN_DIR) {
      await page.route('https://cdn.jsdelivr.net/npm/**', route => {
        const m = route.request().url().match(/\/npm\/([^@/]+)@[^/]+\/(.+)$/);
        let f = m ? path.join(process.env.CDN_DIR, m[1], m[2]) : '';
        if (f && !fs.existsSync(f)) f = f.replace('.min.js', '.js');
        if (f && fs.existsSync(f)) return route.fulfill({ path: f, contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript' });
        return route.abort();
      });
      await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    }
    await page.exposeFunction('__gas', async (fn, argsJson) => {
      try { return JSON.stringify(G.run(fn, ...JSON.parse(argsJson))); }
      catch (e) { errors.push('backend ' + fn + ': ' + e.message); throw e; }
    });
    await page.goto('file://' + file);
    return page;
  }
  async function login(page, u, p) {
    await page.fill('#lg-user', u); await page.fill('#lg-pass', p);
    await page.click('#lg-btn');
    await page.waitForSelector('#app-shell', { state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#dash-kpi-row .card').length >= 6 && !document.querySelector('#dash-kpi-row .skeleton'), null, { timeout: 15000 });
  }
  const settle = page => page.waitForFunction(() => document.getElementById('loader-overlay').style.display === 'none', null, { timeout: 15000 }).then(() => page.waitForTimeout(300));

  // ── Admin desktop
  const page = await newPage({ width: 1440, height: 900 });
  await login(page, ADMIN, PW);
  check('admin login & dashboard', true);
  await page.screenshot({ path: path.join(OUT, '01-dashboard-admin.png') });
  const modules = ['organization', 'master', 'users', 'cleaning', 'visit', 'checklist', 'performance', 'settings'];
  for (const m of modules) {
    await page.evaluate(id => navigateTo(id), m);
    await settle(page);
    const visible = await page.isVisible('#view-' + m);
    check('modul ' + m + ' tampil', visible);
    await page.screenshot({ path: path.join(OUT, '02-' + m + '.png') });
  }
  // Organization: Tim QC Area muncul
  await page.evaluate(() => navigateTo('organization')); await settle(page);
  const orgCards = await page.$$eval('#org-kabag-grid .org-person-card', els => els.length);
  check('Tim QC Area tampil (seluruh roster OP)', orgCards >= data.OP.length - 1, orgCards);
  // Cleaning tabs
  await page.evaluate(() => navigateTo('cleaning')); await settle(page);
  for (const t of ['calendar', 'monthly', 'outlet-group', 'comparison-or', 'table']) {
    await page.evaluate(x => switchCleaningTab(x), t); await page.waitForTimeout(150);
  }
  const noIv = await page.$$eval('#cl-table-container tbody tr', trs => trs.filter(t => /No Interval/.test(t.textContent)).length);
  check('cleaning menampilkan No Interval', noIv > 0, noIv);
  // Settings audit
  await page.evaluate(() => { navigateTo('settings'); switchSettingsTab('audit'); });
  await settle(page);
  await page.click('#btn-run-audit'); await settle(page);
  const auditRows = await page.$$eval('#st-audit-table-box tbody tr', r => r.length);
  check('audit data tampil di Settings', auditRows > 0, auditRows);
  await page.screenshot({ path: path.join(OUT, '03-settings-audit.png') });
  // Help popup
  await page.evaluate(() => openHelp('cleaning')); await page.waitForTimeout(400);
  check('popup panduan', await page.isVisible('#modal-help'));
  await page.evaluate(() => closeModal('modal-help')); await page.waitForTimeout(400);

  // ── QC Area: jadwal → mulai → checklist → submit
  const p2 = await newPage({ width: 1280, height: 860 });
  await login(p2, QCA, PW);
  const navs = await p2.$$eval('#sidebar-nav-list .nav-link', a => a.map(x => x.id));
  check('QC Area tidak melihat menu Master User/Pengaturan', !navs.includes('nav-users') && !navs.includes('nav-settings'), navs.join(','));
  await p2.evaluate(() => navigateTo('visit')); await settle(p2);
  await p2.click('#btn-create-visit'); await settle(p2);
  await p2.waitForSelector('#modal-create-visit.show');
  await p2.fill('#inp-vs-date', '2026-11-08');
  await p2.click('#inp-vs-btn'); await settle(p2);
  const created = await p2.evaluate(() => (VISIT_CACHE.visits || []).find(v => v.NamaQCArea && v.Status === 'Planned'));
  check('QC Area membuat jadwal via UI', !!created);
  await p2.evaluate(id => viewVisitDetailById(id), created.IDVisit); await settle(p2);
  await p2.click('#mod-vs-actions .btn-primary'); await p2.waitForSelector('#modal-confirm.show');
  await p2.click('#confirm-btn-yes'); await settle(p2);
  await p2.evaluate(id => startChecklistForVisit(id), created.IDVisit);
  await p2.waitForFunction(() => CHECKLIST_ITEMS_RAW.length > 0, null, { timeout: 15000 });
  await settle(p2);
  const nItems = await p2.evaluate(() => { CHECKLIST_ITEMS_RAW.forEach((it, i) => { CHECKLIST_ANSWERS[it.idCheck] = { score: i % 3 === 0 ? 3 : 5, isNA: false, catatan: '' }; }); renderChecklistQuestions(); recalculateLiveScore(); return CHECKLIST_ITEMS_RAW.length; });
  check('form checklist memuat item master (Cinema+F&B)', nItems > 20, nItems);
  await p2.screenshot({ path: path.join(OUT, '04-checklist-form.png') });
  await p2.click('#btn-submit-checklist'); await p2.waitForSelector('#modal-confirm.show');
  await p2.click('#confirm-btn-yes'); await settle(p2);
  await p2.waitForTimeout(500);
  const rowsCk = await p2.$$eval('#ck-list-table-box tbody tr', r => r.length);
  check('checklist tersubmit & muncul di riwayat', rowsCk >= 1, rowsCk);
  await p2.screenshot({ path: path.join(OUT, '05-checklist-history.png') });
  await p2.evaluate(() => navigateTo('performance')); await settle(p2);
  await p2.screenshot({ path: path.join(OUT, '06-performance-qcarea.png') });

  // ── Outlet: tombol aksi dibatasi
  const p3 = await newPage({ width: 1280, height: 860 });
  await login(p3, OUTLET, PW);
  await p3.evaluate(() => navigateTo('visit')); await settle(p3);
  check('Outlet tidak melihat tombol buat jadwal', !(await p3.isVisible('#btn-create-visit')));

  // ── Mobile
  const pm = await newPage({ width: 390, height: 844 });
  await login(pm, ADMIN, PW);
  const overflow = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('mobile: tanpa horizontal overflow', !overflow);
  const sbHidden = await pm.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().right <= 0);
  check('mobile: sidebar tersembunyi (drawer)', sbHidden);
  await pm.screenshot({ path: path.join(OUT, '07-mobile-dashboard.png') });
  await pm.evaluate(() => toggleMobileSidebar(true)); await pm.waitForTimeout(400);
  await pm.screenshot({ path: path.join(OUT, '08-mobile-drawer.png') });
  await pm.evaluate(() => navigateTo('cleaning')); await settle(pm);
  await pm.screenshot({ path: path.join(OUT, '09-mobile-cleaning.png') });
  const overflow2 = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('mobile cleaning: tanpa horizontal overflow halaman', !overflow2);

  // Logout confirmation
  await page.evaluate(() => logout(false)); await page.waitForSelector('#modal-confirm.show');
  await page.click('#confirm-btn-yes'); await page.waitForTimeout(400);
  check('logout dengan konfirmasi', await page.isVisible('#login-screen'));

  await browser.close();
  results.forEach(r => console.log(`  ${r[0]} ${r[1]}${r[2] !== '' ? ' (' + r[2] + ')' : ''}`));
  const uniqErr = [...new Set(errors)];
  console.log('\nError JS/console: ' + uniqErr.length);
  uniqErr.slice(0, 20).forEach(e => console.log('   - ' + e));
  const failed = results.filter(r => r[0] === '✗').length;
  console.log(`\nHasil UI: ${results.length - failed} lulus, ${failed} gagal`);
  process.exit(failed || uniqErr.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
