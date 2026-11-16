# CINEMA HUB — Project Structure

Struktur kompatibel dengan **clasp** (`rootDir: src`). Di editor Apps Script, folder tampil sebagai nama file bertingkat
(mis. `server/core/Gateway`). File `.js` menjadi `.gs` saat di-push. Semua file klien adalah `.html`
(Apps Script hanya mendukung `.gs` dan `.html`), lalu digabung lewat `include_()` pada template.

```
cinema-hub/
├── README.md                         Ringkasan & cara memulai
├── package.json                      Script test & lint (Node, tidak di-deploy)
├── .clasp.json.example               Template konfigurasi clasp (scriptId diisi sendiri)
├── .claspignore
├── docs/
│   ├── 01-ARCHITECTURE.md
│   ├── 02-DATABASE-SCHEMA.md
│   ├── 03-PROJECT-STRUCTURE.md
│   ├── 04-DESIGN-SYSTEM.md
│   ├── 05-DEPLOYMENT-GUIDE.md        (Phase 6)
│   ├── 06-ADMIN-GUIDE.md             (Phase 6)
│   ├── 07-EMPLOYEE-GUIDE.md          (Phase 6)
│   ├── 08-TESTING-REPORT.md          (diperbarui tiap fase)
│   ├── 09-KNOWN-LIMITATIONS.md
│   └── 10-BACKUP-RECOVERY.md
├── templates/                        Template Excel resmi (.xlsx) — dihasilkan dari Schema.js
│   ├── TEMPLATE_MOVIE_TODAY.xlsx
│   ├── TEMPLATE_UPCOMING_MOVIES.xlsx
│   ├── TEMPLATE_PROMOS.xlsx
│   └── TEMPLATE_EMPLOYEES.xlsx
├── tests/
│   ├── emulator/                     Emulator GAS in-memory (SpreadsheetApp, CacheService, …)
│   ├── unit/                         L1 — node:test
│   ├── integration/                  L2 — API end-to-end melalui apiCall()
│   ├── e2e/                          L3 — Playwright (UI + responsif)
│   └── fixtures/                     File Excel valid/invalid/duplikat untuk uji import
├── tools/
│   ├── build-templates.js            Generate templates/*.xlsx dari Schema.js
│   └── dev-server.js                 Menjalankan klien + emulator di localhost untuk uji UI
└── src/                              ← satu-satunya folder yang di-deploy ke Apps Script
    ├── appsscript.json               Runtime V8, timeZone Asia/Jakarta, webapp, oauthScopes minimal
    ├── server/
    │   ├── core/
    │   │   ├── Config.js             Konstanta, nama sheet, batas default, akses Script Properties
    │   │   ├── Errors.js             AppError + kode error standar
    │   │   ├── Utils.js              Tanggal/waktu (TZ), generator ID, normalisasi teks, hash
    │   │   ├── Sanitize.js           Sanitasi input, anti formula-injection
    │   │   ├── Validator.js          Validasi payload berbasis deskriptor skema
    │   │   ├── Cache.js              Cache chunked + versi tabel
    │   │   ├── Lock.js               withScriptLock_()
    │   │   ├── Router.js             Registry aksi (action → permission, schema, handler)
    │   │   └── Gateway.js            doGet(), apiCall(), include_() — satu-satunya fungsi publik
    │   ├── data/
    │   │   ├── Schema.js             Definisi seluruh tabel + import definition
    │   │   ├── Database.js           Koneksi spreadsheet, getTable_()
    │   │   ├── SheetRepository.js    CRUD batch generik (find, insertMany, update, softDelete, replaceScope)
    │   │   └── Seed.js               Data referensi + seedDemoData()
    │   ├── security/
    │   │   ├── Password.js           PBKDF2-HMAC-SHA256, kebijakan password
    │   │   ├── Session.js            Buat/verifikasi/cabut sesi
    │   │   ├── Rbac.js               Matriks permission + guard
    │   │   └── Audit.js              audit_(), logError_()
    │   ├── services/
    │   │   ├── AuthService.js
    │   │   ├── DashboardService.js
    │   │   ├── SearchService.js
    │   │   ├── MovieService.js
    │   │   ├── PromoService.js
    │   │   ├── LayoutService.js      Cinema & Mall (satu service, dua tipe)
    │   │   ├── EducationService.js
    │   │   ├── ProblemService.js     Problems + Solutions + Comments + Helpful
    │   │   ├── EmployeeService.js
    │   │   ├── AnnouncementService.js
    │   │   ├── NotificationService.js
    │   │   ├── ImportService.js      Engine import reusable
    │   │   ├── FileService.js        Drive: upload, dedup, proxy, arsip
    │   │   ├── UserService.js        Users, roles, permissions, sesi
    │   │   ├── AuditService.js       Query audit/error log
    │   │   └── SettingsService.js    APP_CONFIG, LOOKUPS, OUTLETS
    │   ├── routes/
    │   │   └── Routes.js             Registrasi seluruh aksi (satu tempat untuk direview)
    │   └── setup/
    │       ├── Setup.js              setupCinemaHub(), assertEditorContext_()
    │       ├── Triggers.js           Job harian/bulanan
    │       └── SelfTest.js           runSelfTests() untuk lingkungan Apps Script nyata
    └── client/
        ├── Index.html                Shell dokumen: <head>, include CSS/JS, root container
        ├── styles/
        │   ├── Tokens.html           CSS custom properties (light + dark)
        │   ├── Base.html             Reset, tipografi, utilitas
        │   ├── Layout.html           Sidebar, topbar, grid, responsif
        │   ├── Components.html       Button, input, card, badge, table, modal, toast, skeleton, …
        │   └── Pages.html            Gaya khusus halaman (login, movie, promo, …)
        ├── assets/
        │   └── Icons.html            SVG sprite (<symbol>) — satu set ikon konsisten
        ├── core/
        │   ├── Api.html              google.script.run → Promise, error & sesi
        │   ├── Store.html            State global kecil (user, permissions, config)
        │   ├── Router.html           Hash router + guard permission + breadcrumb
        │   ├── Dom.html              esc(), h() helper, format tanggal/angka, debounce
        │   └── Markdown.html         Renderer Markdown aman
        ├── components/
        │   ├── Ui.html               Toast, Modal, Confirm, Drawer, Dropdown, Tabs
        │   ├── DataTable.html        Tabel + sort + pagination
        │   ├── FilterBar.html        Search + filter chips + select
        │   ├── States.html           Skeleton, Empty, Error, Forbidden
        │   ├── FileField.html        Upload dengan preview & validasi
        │   └── MediaViewer.html      Preview gambar/PDF (lazy PDF.js)
        ├── shell/
        │   ├── Login.html
        │   ├── AppShell.html         Sidebar, topbar, search global, notifikasi, menu profil
        │   └── Menu.html             Definisi menu + permission
        └── pages/
            ├── Dashboard.html
            ├── MovieToday.html
            ├── UpcomingMovies.html
            ├── PromoToday.html
            ├── Layouts.html          Cinema Layout & Mall Layout
            ├── Education.html
            ├── Problems.html
            ├── Employees.html
            ├── Announcements.html
            ├── Profile.html          Profil saya & ganti password
            └── admin/
                ├── Users.html
                ├── Content.html
                ├── Imports.html
                ├── AuditLogs.html
                └── Settings.html
```

## Konvensi Kode

| Area | Konvensi |
|---|---|
| Modul server | `const XxxService = (() => { …; return { list, detail, save }; })();` |
| Fungsi top-level privat | Berakhiran `_` (tidak terekspos ke `google.script.run`) |
| Fungsi top-level publik | **Hanya** `doGet`, `apiCall`, dan fungsi editor (`setupCinemaHub`, `seedDemoData`, `runSelfTests`) yang dijaga `assertEditorContext_()` |
| Penamaan aksi | `modul.aksi` lowercase camel (`movie.today.list`) |
| Penamaan permission | `modul.verb` (`promo.manage`) |
| Bahasa | Kode & identifier: Inggris. Teks UI, pesan error, dokumentasi: Bahasa Indonesia |
| Modul klien | `window.CH.pages.<Nama> = { route, title, permission, render(el, params), destroy() }` |
| CSS | Prefiks kelas `ch-` + BEM ringan (`ch-card`, `ch-card__title`, `ch-card--featured`) |
| Tidak boleh | `innerHTML` dengan data mentah, `getValue()` di dalam loop, `eval`, secret di klien |
