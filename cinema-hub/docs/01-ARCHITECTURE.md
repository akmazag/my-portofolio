# CINEMA HUB — Software Architecture Blueprint

> **One Platform. One Knowledge. One Operation.**
> Dokumen versi 1.0 · Status: **MENUNGGU PERSETUJUAN** · Fase: Blueprint (sebelum Phase 1)

---

## 1. Ringkasan

CINEMA HUB adalah portal internal terpusat untuk operasional bioskop: jadwal film, film mendatang, promo,
layout akses publik (bioskop & mall), pusat edukasi, direktori karyawan, pusat problem & solving, dan pengumuman.

| Aspek | Keputusan |
|---|---|
| Backend | Google Apps Script (runtime V8, ES2020) |
| Database awal | Google Sheets (1 spreadsheet utama, sheet per tabel) |
| File storage | Google Drive (folder privat milik akun pemilik script) |
| Frontend | HtmlService SPA — HTML5, CSS3, JavaScript ES6+, tanpa framework |
| Library frontend | SheetJS (baca/tulis Excel), Chart.js (grafik dashboard admin), PDF.js (preview PDF, lazy-load) |
| Bahasa UI | Bahasa Indonesia |
| Zona waktu | `Asia/Jakarta` (dapat dikonfigurasi) |

### Prinsip arsitektur

1. **Backend adalah sumber kebenaran.** Semua autentikasi, otorisasi, validasi, dan redaksi data pribadi terjadi di server. Frontend hanya menyembunyikan menu untuk kenyamanan, bukan sebagai pengamanan.
2. **Satu pintu masuk API.** Seluruh panggilan klien melewati satu fungsi `apiCall()` (gateway). Tidak ada fungsi server lain yang bisa dipanggil dari browser.
3. **Repository pattern.** Service tidak pernah menyentuh `SpreadsheetApp` langsung. Migrasi ke Firestore / Cloud SQL cukup mengganti implementasi repository.
4. **Schema sebagai single source of truth.** Definisi tabel (`Schema.js`) dipakai sekaligus untuk inisialisasi database, validasi, template Excel, dan engine import.
5. **Batch & cache first.** Baca sekali per tabel (`getValues`), tulis sekali per operasi (`setValues`), cache dengan versi.
6. **Tidak ada data dummy di produksi.** Seeder hanya dijalankan manual untuk lingkungan uji.

---

## 2. Keputusan Teknis Utama (ADR ringkas)

| # | Keputusan | Alasan | Trade-off |
|---|---|---|---|
| ADR-01 | **Single gateway `apiCall(request)`** + router berbasis registry aksi | Autentikasi, RBAC, validasi, audit, dan error handling terpusat; tidak mungkin ada endpoint yang "lupa" dicek | Semua aksi harus diregistrasi di `Router` |
| ADR-02 | Fungsi internal memakai **pola modul IIFE** (`const MovieService = (() => {...})()`) dan helper top-level berakhiran `_` | `google.script.run` hanya bisa memanggil fungsi top-level tanpa `_`. Objek modul tidak dapat dipanggil dari browser | Disiplin penamaan wajib (dicek oleh test) |
| ADR-03 | **Autentikasi custom** (username/email + password) dengan hash **PBKDF2-HMAC-SHA256** (salt per user + pepper di Script Properties) | Berfungsi untuk karyawan yang tidak memiliki akun Google Workspace. Apps Script tidak punya bcrypt; PBKDF2 diimplementasi di atas `Utilities.computeHmacSha256Signature` | Iterasi dibatasi (default 2.000) agar login < 2 detik. Opsi SSO Workspace disiapkan sebagai mode tambahan (lihat §5.6) |
| ADR-04 | **Session token acak 256-bit**, disimpan di server sebagai **hash SHA-256** (sheet `SESSIONS` + CacheService) | Token bocor dari log/sheet tidak bisa dipakai; revoke & expiry dikendalikan server | 1 lookup cache per request (≈ 5–20 ms) |
| ADR-05 | **Parsing Excel di browser (SheetJS)**, **validasi ulang penuh di server** | Preview instan tanpa round-trip upload; tidak perlu Advanced Drive Service. Server tetap tidak mempercayai data klien | Ukuran file dibatasi (default 5.000 baris / 5 MB) |
| ADR-06 | **Import stateless 2 langkah**: `import.preview` (validasi) → `import.commit` (validasi ulang + tulis) | Tidak bergantung pada batas 100 KB per key CacheService; commit selalu memvalidasi data aktual | Payload dikirim dua kali (dapat diterima) |
| ADR-07 | **Web App: Execute as _Me_ (pemilik)**, akses _Anyone_ (atau _Anyone within domain_) | Pengguna tidak butuh akses langsung ke Sheets/Drive → data tidak bisa dibuka di luar aplikasi | Kuota eksekusi dihitung pada akun pemilik (lihat §16) |
| ADR-08 | **File Drive tetap privat**, disajikan lewat **file proxy terotorisasi** (`file.get` → base64 / thumbnail) | Memenuhi "jangan membuat file menjadi public"; hak akses file = hak akses aplikasi | Batas ukuran per transfer (default 10 MB). Video besar via tautan eksternal (lihat §17) |
| ADR-09 | **Status turunan dihitung saat baca** (promo aktif/expired, film sedang tayang, upcoming → today) + trigger harian untuk persist | Tidak pernah menampilkan status basi meski trigger gagal | Sedikit komputasi per request (ringan, data sudah di-cache) |
| ADR-10 | **Soft delete** (`status = INACTIVE/ARCHIVED`) dan **ID string permanen** | Tidak bergantung pada nomor baris; jejak audit utuh | Sheet bertambah; diatasi dengan arsip berkala |
| ADR-11 | **Optimistic concurrency** (`row_version`) + **LockService** untuk tulis | Mencegah overwrite diam-diam saat dua admin mengedit data yang sama | Pengguna kedua menerima pesan konflik dan perlu memuat ulang |
| ADR-12 | Proyek **kompatibel `clasp`** (folder `src/`), tetap bisa disalin manual ke editor | Version control di Git + deployment terotomasi | — |

---

## 3. Arsitektur Tingkat Tinggi

```
┌──────────────────────────── Browser (HtmlService iframe) ─────────────────────────────┐
│  Index.html → App Shell (Sidebar · Topbar · Breadcrumb · Search · Notifikasi)         │
│  Router (#/hash) → Page Module (render/destroy) → UI Components (Card, Table, Modal…)  │
│  Core: Api (google.script.run → Promise) · Store · Escape/Format · SheetJS (import)    │
└────────────────────────────────────────┬──────────────────────────────────────────────┘
                                         │ apiCall({ action, payload, token, reqId })
┌────────────────────────────────────────▼──────────────────────────────────────────────┐
│ GATEWAY  Main.apiCall                                                                  │
│   1. Router.resolve(action)          → 404 jika aksi tidak terdaftar                   │
│   2. Session.verify(token)           → 401 SESSION_EXPIRED / UNAUTHENTICATED           │
│   3. Rbac.authorize(user, perm)      → 403 FORBIDDEN (+ audit DENIED)                  │
│   4. Validator.check(payload,schema) → 422 VALIDATION_ERROR                            │
│   5. handler(ctx, payload)           → Service → Repository                            │
│   6. Response envelope {ok,data,error,meta} · ERROR_LOGS bila exception                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ SERVICES  Auth · User · Dashboard · Movie · Promo · Layout · Education · Employee ·    │
│           Problem · Announcement · Search · Import · File · Audit · Settings · Notif   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ DATA      SheetRepository (generic CRUD batch) · Schema · Database (init/migrate)     │
│ CROSS     Cache (CacheService, chunked+versioned) · Lock (LockService) · Config ·      │
│           Audit · Errors · Utils (tanggal, ID, sanitasi)                               │
└───────────┬──────────────────────────────┬──────────────────────────────┬─────────────┘
            ▼                              ▼                              ▼
   Google Sheets (DB utama)       Google Drive (CINEMA_HUB/)     PropertiesService
   + Spreadsheet BACKUP/ARSIP     file privat, dedup SHA-256     (ID spreadsheet, folder, pepper)
```

### 3.1 Kontrak request / response

```js
// Request dari klien
{ action: 'promo.list', payload: { q: 'popcorn', category: 'FNB', page: 1, pageSize: 12 },
  token: '<session token>', reqId: 'r-1731744000-7' }

// Response sukses
{ ok: true, data: { items: [...], total: 37, page: 1, pageSize: 12 },
  meta: { reqId: 'r-…', serverTime: '2026-11-16T09:12:00+07:00', ms: 84 } }

// Response gagal
{ ok: false, error: { code: 'FORBIDDEN', message: 'Anda tidak memiliki akses ke fitur ini.',
  errorId: 'ERR-261116-4K9Q' }, meta: {...} }
```

Kode error standar: `UNAUTHENTICATED`, `SESSION_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`,
`CONFLICT` (row_version), `DUPLICATE`, `RATE_LIMITED`, `LOCK_TIMEOUT`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `INTERNAL_ERROR`.
Pesan `INTERNAL_ERROR` ke klien selalu generik + `errorId`; detail (stack) hanya di `ERROR_LOGS`.

### 3.2 Registrasi aksi (contoh)

```js
Router.register({
  action: 'promo.list',
  permission: 'promo.view',
  schema: { q: 'string?:100', category: 'code?', outlet: 'code?', state: 'enum?:ACTIVE,UPCOMING,EXPIRED,ALL',
            page: 'int?:1-1000', pageSize: 'int?:1-100' },
  audit: false,                      // aksi baca tidak diaudit (kecuali data sensitif)
  handler: (ctx, p) => PromoService.list(ctx, p)
});
```

`ctx` berisi `{ user, permissions, session, reqId, now }` — **dibangun di server dari token**, bukan dari payload.

---

## 4. Alur Aplikasi

1. `doGet()` mengembalikan `Index.html` (template, include CSS/JS) dengan `XFrameOptionsMode.DEFAULT` dan meta viewport.
2. Klien membaca token dari `sessionStorage` (atau `localStorage` jika "Ingat saya").
3. Ada token → `auth.bootstrap` (1 round-trip): profil, permission, menu, konfigurasi publik, badge notifikasi.
   Tidak ada / ditolak → tampil halaman Login.
4. Router merender halaman sesuai hash (`#/movies/today`). Halaman tanpa permission → state "Akses ditolak".
5. Setiap response `SESSION_EXPIRED` → token dihapus, modal "Sesi berakhir", kembali ke Login dengan `returnTo`.

---

## 5. Autentikasi & Manajemen Sesi

### 5.1 Login
- Input: username **atau** email + password; toggle show/hide; checkbox "Ingat saya".
- Server: normalisasi (lowercase, trim) → cari user `ACTIVE` → cek `locked_until` → verifikasi hash (constant-time compare).
- Pesan gagal **selalu generik**: "Username atau password salah." (tidak membocorkan keberadaan akun).
- Brute force: 5 gagal dalam 15 menit → akun terkunci 15 menit (`USERS.failed_attempts`, `locked_until`) + throttle per username di CacheService. Semua percobaan gagal diaudit.

### 5.2 Penyimpanan password
```
hash = PBKDF2-HMAC-SHA256(password, salt = 16 byte acak per user, key = PEPPER, iterations = 2000, dkLen = 32)
USERS.password_hash  = base64(hash)
USERS.password_salt  = base64(salt)
USERS.password_algo  = "pbkdf2-sha256$2000"     // memungkinkan upgrade iterasi tanpa reset password
```
`PEPPER` disimpan di **Script Properties**, tidak pernah di sheet maupun frontend. Kebijakan password: min. 8 karakter, huruf + angka, tidak sama dengan username. User baru / reset → `must_change_password = TRUE`.

### 5.3 Sesi
| Parameter (APP_CONFIG) | Default |
|---|---|
| `SESSION_IDLE_MINUTES` | 60 |
| `SESSION_ABSOLUTE_HOURS` | 12 |
| `SESSION_REMEMBER_DAYS` | 7 (hanya jika "Ingat saya") |
| `MAX_SESSIONS_PER_USER` | 5 (sesi terlama dicabut) |

- Token: 32 byte acak (`Utilities.getUuid()` ×2 + digest) → dikirim **sekali** ke klien. Server menyimpan `SHA-256(token)`.
- Verifikasi: cache `sess:<hash>` (TTL 10 menit) → fallback sheet `SESSIONS`. `last_seen_at` diperbarui maks. 1×/5 menit (hemat tulis).
- Logout: status `REVOKED`, cache dihapus. Nonaktifkan user / ganti role → seluruh sesinya dicabut.
- Admin dapat mencabut sesi pengguna dari User Management.

### 5.4 Fungsi yang dapat dipanggil dari browser
Hanya `doGet` dan `apiCall`. Fungsi setup (`setupCinemaHub`, `seedDemoData`, `runSelfTests`) bersifat top-level agar bisa dijalankan dari editor, **tetapi** diproteksi `assertEditorContext_()` (menolak jika `Session.getActiveUser()` ≠ pemilik script) — panggilan dari web app ditolak dan diaudit.

### 5.5 Unauthorized handling
- Backend: setiap aksi wajib punya `permission`; aksi tanpa permission terdaftar akan gagal saat registrasi (fail-closed).
- Frontend: halaman 401 → Login; 403 → halaman "Akses ditolak" dengan tombol kembali ke Dashboard.

### 5.6 Opsi Google Workspace SSO (disiapkan, nonaktif secara default)
Jika seluruh karyawan memiliki akun Workspace satu domain: deploy *Execute as: User accessing* atau *Anyone within domain* dan identitas diambil **server-side** dari `Session.getActiveUser().getEmail()` lalu dicocokkan ke `USERS.email`. Email dari frontend tidak pernah dipakai. Mode dipilih lewat `AUTH_MODE = PASSWORD | WORKSPACE | HYBRID`.

---

## 6. Role-Based Access Control

### 6.1 Model
`USERS.role_id → ROLES` · `ROLE_PERMISSIONS (role_id, permission_key)` · `PERMISSIONS` (katalog).
Menambah role atau permission = menambah baris data, **tanpa** mengubah kode. Matriks di-cache (`rbac:v<n>`), invalidasi saat diubah.

### 6.2 Katalog permission & matriks default

✅ = diberikan · — = tidak · 🔒 = data sensitif

| Permission | SUPER ADMIN | ADMIN | MANAGEMENT | CINEMA MANAGER | EMPLOYEE |
|---|:-:|:-:|:-:|:-:|:-:|
| `dashboard.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `report.view` (statistik & grafik) | ✅ | ✅ | ✅ | ✅ | — |
| `movie.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `movie.manage` / `movie.import` | ✅ | ✅ | — | — | — |
| `promo.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `promo.manage` / `promo.import` | ✅ | ✅ | — | — | — |
| `layout_cinema.view` / `.download` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `layout_cinema.manage` | ✅ | ✅ | — | — | — |
| `layout_mall.view` / `.download` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `layout_mall.manage` | ✅ | ✅ | — | — | — |
| `education.view` / `.download` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `education.manage` | ✅ | ✅ | — | — | — |
| `problem.view` / `.submit` / `.comment` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `problem.review` (approve/publish) | ✅ | ✅ | — | — | — |
| `problem.manage` (edit/arsip semua) | ✅ | ✅ | — | — | — |
| `employee.view` | ✅ | ✅ | ✅ | ✅ | — |
| `employee.view_contact` (telepon) 🔒 | ✅ | ✅ | ✅ | ✅ | — |
| `employee.view_sensitive` (NIK) 🔒 | ✅ | ✅ | ✅ | — | — |
| `employee.manage` / `employee.import` | ✅ | ✅ | — | — | — |
| `announcement.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `announcement.manage` | ✅ | ✅ | ✅ | — | — |
| `content.manage` (Content Management) | ✅ | ✅ | — | — | — |
| `import.manage` (riwayat & rollback) | ✅ | ✅ | — | — | — |
| `file.upload` | ✅ | ✅ | ✅ | ✅ | ✅* |
| `user.manage` | ✅ | — | — | — | — |
| `role.manage` | ✅ | — | — | — | — |
| `audit.view` | ✅ | — | — | — | — |
| `settings.manage` | ✅ | — | — | — | — |

\* EMPLOYEE hanya dapat mengunggah lampiran pada problem/solution miliknya sendiri (dicek pada level entitas).

### 6.3 Aturan tambahan (row/field-level)
- **Field-level:** `EmployeeService` menghapus `nik` tanpa `employee.view_sensitive` dan `phone` tanpa `employee.view_contact` **sebelum** data meninggalkan server (termasuk hasil global search & export).
- **Ownership:** problem/solution berstatus `DRAFT/SUBMITTED` hanya bisa diedit oleh pembuatnya atau `problem.manage`.
- **Audience:** pengumuman difilter server-side berdasarkan `target_roles`, `target_areas`, `target_outlets`.
- **Guard role:** hanya SUPER ADMIN yang dapat memberikan role SUPER ADMIN; minimal satu SUPER ADMIN aktif harus selalu ada.

---

## 7. Aturan Bisnis per Modul

### 7.1 Movie Today
- Satu baris `MOVIE_TODAY` = satu jadwal (tanggal + film + outlet + studio + jam). Data master film (judul, genre, sinopsis, poster) disimpan di `MOVIES` dan di-*upsert* saat import (pemisahan master–transaksi).
- **Kunci duplikasi:** `show_date + movie_id + outlet_id + studio + show_time`.
- Status tampilan dihitung dari waktu server (`Asia/Jakarta`):
  `Akan Tayang` (now < jam tayang) · `Sedang Tayang` (dalam durasi) · `Selesai` · `Dibatalkan` (status import `CANCELLED`).
- Mode **Movie Overview** (dikelompokkan per film, chip jam tayang) dan **Detailed Schedule** (tabel per tanggal → studio → jam). Default tanggal = hari ini.

### 7.2 Upcoming Movies
- Baris `UPCOMING_MOVIES` mereferensikan `MOVIES.movie_id` + `release_date` + `upcoming_status`.
- **Perpindahan ke Today hanya berdasarkan data operasional:** film tampil di Today jika ada baris `MOVIE_TODAY` aktif untuk `movie_id` pada tanggal tersebut. Bila tanggal rilis sudah lewat tetapi jadwal belum ada → label **"Menunggu Jadwal Tayang"** (tetap di Upcoming, ditandai untuk admin). Sistem **tidak pernah** mengasumsikan film tayang hanya dari tanggal rilis.
- Countdown dihitung di klien dari `release_date` + `serverTime` (bukan jam perangkat).

### 7.3 Promo Today
- Status efektif: `INACTIVE` (dinonaktifkan) · `UPCOMING` (today < start) · `ACTIVE` (start ≤ today ≤ end) · `EXPIRED` (today > end).
- Daftar "Promo Aktif" **hanya** `ACTIVE`; promo expired otomatis masuk "Riwayat Promo". Trigger harian 00:05 mem-persist status untuk pelaporan.
- `outlets` = `ALL` atau daftar kode outlet; filter outlet menghormati nilai `ALL`.

### 7.4 Layout Bioskop & Mall
- Konten berupa lokasi + foto/diagram (gambar) + dokumen (PDF) + teks petunjuk.
- Download dicek dengan `*.download`; file proxy memvalidasi bahwa `file_id` memang milik entitas yang boleh diakses.

### 7.5 Education Center
- Format: `ARTICLE` (konten Markdown aman), `PDF`, `PPT`, `VIDEO`, `IMAGE`, `LINK`.
- Bookmark, recently viewed, view count, featured, dan progress baca (`USER_ACTIVITY`).
- PPT: file asli disimpan; preview melalui PDF hasil konversi (bila Advanced Drive Service diaktifkan) atau download.
- Quiz: **di luar cakupan rilis 1** (sesuai brief "pengembangan berikutnya"); skema `QUIZZES` disiapkan di dokumen schema sebagai rencana.

### 7.6 Problem & Solving
Alur status:
```
DRAFT → SUBMITTED → (review) → PUBLISHED → ARCHIVED
                       └──────→ REJECTED (dengan catatan) → bisa direvisi → SUBMITTED
```
- Format dokumentasi baku: **PROBLEM → SYMPTOM → ROOT CAUSE → SOLUTION (langkah) → PREVENTION**.
- Satu problem dapat memiliki beberapa solusi; satu ditandai **Solusi Terverifikasi**.
- Tombol "Bermanfaat" (1 suara per user), komentar, related problems (kategori + kata kunci) dan related knowledge (link ke Education).

### 7.7 Announcement
- Prioritas `LOW/NORMAL/HIGH/CRITICAL`, pin, `publish_at` terjadwal, `expire_at`.
- `CRITICAL` muncul sebagai banner di Dashboard sampai dibaca. Notifikasi dibuat untuk audience target.

### 7.8 Employee Directory
- `employee_id` unik (validasi saat tambah, edit, dan import). Nonaktifkan = `status INACTIVE` (tidak dihapus).
- Akun login (`USERS`) dapat ditautkan ke `employee_id`, tetapi direktori karyawan tidak mewajibkan akun.

---

## 8. Excel Import Engine (reusable)

Modul yang didukung rilis 1: `MOVIE_TODAY`, `UPCOMING_MOVIES`, `PROMOS`, `EMPLOYEES`. Menambah modul baru = menambah **import definition** di `Schema.js`.

```
[1 Pilih modul] → [2 Unduh template .xlsx/.csv] → [3 Upload file]
      → [4 SheetJS parse di browser + cek header] → [5 import.preview (server)]
      → [6 Preview tabel: Valid · Invalid · Duplikat · Field wajib kosong]
      → [7 Pilih mode APPEND / REPLACE (+ ketik "REPLACE" untuk konfirmasi)]
      → [8 import.commit: lock → validasi ulang → backup (REPLACE) → batch write → log]
      → [9 Hasil: total, berhasil, gagal, duplikat, detail error + unduh laporan error .csv]
```

| Aturan | Implementasi |
|---|---|
| Header tidak sesuai | Pencocokan header case-insensitive + alias; kolom wajib hilang → file ditolak dengan daftar kolom |
| File kosong / hanya header | Ditolak: "File tidak berisi data." |
| Format tanggal | Diterima: `yyyy-MM-dd`, `dd/MM/yyyy`, `dd-MM-yyyy`, serial Excel → dinormalisasi ke `yyyy-MM-dd` |
| Format jam | `HH:mm` / `H.mm` / fraksi hari Excel → `HH:mm` |
| Duplikat dalam file | Berdasarkan kunci bisnis per modul; baris kedua dst. ditandai `DUPLICATE_IN_FILE` |
| Duplikat dengan database | APPEND: dilewati & dilaporkan. REPLACE: data lama dalam *scope* diganti |
| Scope REPLACE | Movie Today: tanggal yang ada di file · Upcoming/Promo/Employee: seluruh tabel modul |
| Backup | Sebelum REPLACE: sheet disalin ke spreadsheet `CINEMA_HUB_BACKUP` (tab `MOVIE_TODAY_20261116_0912_IMP-…`); referensi disimpan di `IMPORT_LOGS.backup_ref` |
| Rollback | `import.rollback(importId)` memulihkan dari backup (SUPER ADMIN / `import.manage`) |
| Batas | `IMPORT_MAX_ROWS` 5.000, `IMPORT_MAX_FILE_MB` 5 |
| Riwayat | `IMPORT_LOGS` + file asli diarsipkan ke `CINEMA_HUB/_SYSTEM/IMPORTS/` |
| Formula injection | Teks diawali `= + - @` ditulis sebagai teks literal (format kolom `@`) |

---

## 9. Google Drive File Management

```
CINEMA_HUB/
├── MOVIE_POSTERS/      ├── EDUCATION/
├── PROMO_BANNERS/      ├── EMPLOYEE_PHOTOS/
├── CINEMA_LAYOUT/      ├── PROBLEM_SOLVING/
├── MALL_LAYOUT/        ├── ANNOUNCEMENTS/
└── _SYSTEM/            ← tambahan: IMPORTS/ (arsip file import), BACKUPS/, EXPORTS/
```

- `FILES` menyimpan `drive_file_id` (bukan hanya URL), modul, entitas pemilik, mime, ukuran, **SHA-256**, status.
- **Validasi:** whitelist MIME + ekstensi per modul (mis. poster: jpg/png/webp; edukasi: pdf/pptx/mp4/jpg/png), ukuran maks per modul dari `APP_CONFIG`, magic-byte check untuk gambar & PDF.
- **Dedup:** SHA-256 sama dalam modul yang sama → pakai ulang file lama.
- **Update:** file baru diunggah, file lama `ARCHIVED` (dipindah ke subfolder `_ARCHIVE`), tidak dihapus permanen.
- **Akses:** semua file privat milik pemilik script. Klien hanya menerima `file_id` internal (`FIL-…`), lalu memanggil `file.get` / `file.thumbnail`; server memeriksa permission modul + kepemilikan entitas sebelum membaca dari Drive.
- Thumbnail kartu: `DriveApp.getFileById().getThumbnail()` di-cache (≤ 90 KB) → hemat bandwidth.

---

## 10. Performa & Skalabilitas

| Teknik | Detail |
|---|---|
| Batch read | Satu `getRange(...).getValues()` per tabel per request; tidak ada `getValue()` dalam loop |
| Batch write | `setValues()` untuk insert banyak baris; update baris tunggal = satu `setValues` 1×N |
| Cache tabel | `CacheService` script cache, data dipecah per 90 KB (batas 100 KB/key), key berversi `t:<TABLE>:v<n>`; versi dinaikkan setiap tulis → invalidasi O(1) |
| Index ID | Peta `id → row` di-cache; soft delete menjaga indeks stabil |
| Agregasi dashboard | `dashboard.summary` = **1 round-trip** berisi semua widget |
| Pagination | Server-side (`page`, `pageSize`, `total`), default 12 kartu / 20 baris |
| Search | Normalisasi teks (lowercase, tanpa diakritik), pencarian pada field terindeks per modul dari data cache; hasil global search dibatasi 5 per modul |
| Lazy loading | Gambar via `IntersectionObserver`; halaman dimuat saat dibuka; PDF.js & Chart.js dimuat hanya saat dibutuhkan |
| Lock | `LockService.getScriptLock().waitLock(10000)` hanya membungkus bagian tulis |
| Log besar | `AUDIT_LOGS` / `ERROR_LOGS` tidak pernah dibaca penuh; dibaca dari bawah per halaman. Trigger bulanan mengarsipkan log > 90 hari |
| Kuota | Request dirancang < 3 detik; operasi berat (import 5.000 baris) < 60 detik |

**Jalur migrasi:** `SheetRepository` mengimplementasikan antarmuka `find / findById / insertMany / update / softDelete / replaceScope`. Implementasi `FirestoreRepository` / `JdbcRepository` (Cloud SQL) cukup memenuhi antarmuka yang sama; service & frontend tidak berubah.

---

## 11. Keamanan & Tata Kelola Data

| Ancaman | Mitigasi |
|---|---|
| Pemanggilan backend tanpa login | Gateway tunggal, token wajib, fail-closed |
| Eskalasi hak akses | Permission dicek di server per aksi; `ctx.user` dari sesi, bukan payload; guard role SUPER ADMIN |
| XSS | Semua output melalui `esc()`; tidak ada `innerHTML` dengan data mentah; artikel = Markdown yang di-render oleh renderer aman (escape dulu, whitelist tag) ; URL divalidasi (`https:` saja) |
| Formula/CSV injection | Prefiks literal untuk nilai berawalan `= + - @` saat tulis ke Sheets & export CSV |
| Brute force | Lockout + throttle + audit |
| Kebocoran token | Disimpan hash di server; expiry idle & absolut; revoke |
| Kebocoran data pribadi | Redaksi field-level di server; NIK/telepon tidak pernah masuk cache publik/hasil search tanpa izin |
| File berbahaya | Whitelist MIME/ekstensi, magic-byte check, batas ukuran, file tidak dieksekusi |
| Clickjacking | `XFrameOptionsMode.DEFAULT` (tidak di-embed ke situs lain) |
| Secret di frontend | Tidak ada; ID spreadsheet/folder & pepper hanya di Script Properties |
| Akses langsung ke Sheet/Drive | Web app *execute as owner*; file & spreadsheet tidak dibagikan ke pengguna |

---

## 12. Error Handling & Logging

- Server: setiap handler dibungkus `try/catch` di gateway. `AppError` (terduga) → kode + pesan ramah. Error lain → `INTERNAL_ERROR` + `errorId` + baris di `ERROR_LOGS` (stack, aksi, user, payload yang sudah disensor).
- Klien: `Api.call` menangani timeout (60 s), retry 1× untuk kegagalan jaringan pada aksi baca, toast untuk error, error state di halaman dengan tombol "Coba lagi".
- **Audit log:** login/logout/gagal login, semua create/update/delete/publish/import/rollback, perubahan role/permission/setting, akses data sensitif (lihat NIK), penolakan akses (`DENIED`). Nilai sensitif (password, token, NIK) tidak pernah ditulis ke log.

---

## 13. Katalog API (action)

| Modul | Aksi |
|---|---|
| auth | `auth.login`, `auth.logout`, `auth.bootstrap`, `auth.changePassword` |
| dashboard | `dashboard.summary`, `search.global` |
| movie | `movie.today.list`, `movie.today.dates`, `movie.detail`, `movie.upcoming.list`, `movie.save`, `movie.schedule.save`, `movie.archive` |
| promo | `promo.list` (state ACTIVE/UPCOMING/EXPIRED/ALL), `promo.detail`, `promo.save`, `promo.archive` |
| layout | `layout.list` (type CINEMA/MALL), `layout.detail`, `layout.save`, `layout.archive` |
| education | `education.list`, `education.detail`, `education.save`, `education.archive`, `education.bookmark`, `education.progress`, `education.recent` |
| problem | `problem.list`, `problem.detail`, `problem.save`, `problem.submit`, `problem.review`, `problem.archive`, `solution.save`, `solution.review`, `problem.helpful`, `comment.list`, `comment.add`, `comment.hide` |
| employee | `employee.list`, `employee.detail`, `employee.save`, `employee.deactivate`, `employee.filters` |
| announcement | `announcement.list`, `announcement.detail`, `announcement.save`, `announcement.archive`, `announcement.markRead` |
| notification | `notification.list`, `notification.markRead` |
| import | `import.templates`, `import.preview`, `import.commit`, `import.history`, `import.rollback` |
| file | `file.upload`, `file.get`, `file.thumbnail`, `file.archive` |
| admin | `user.list`, `user.save`, `user.resetPassword`, `user.setStatus`, `user.revokeSessions`, `role.list`, `role.savePermissions`, `audit.list`, `settings.get`, `settings.save`, `lookup.list`, `lookup.save`, `outlet.list`, `outlet.save` |

---

## 14. Strategi Pengujian

Karena Apps Script tidak dapat dijalankan di luar akun Google, pengujian dibagi tiga lapis dan **laporan uji akan selalu menyebut lapis mana yang sudah dijalankan**:

| Lapis | Alat | Cakupan |
|---|---|---|
| L1 — Unit | Node.js `node:test` + shim `Utilities` | Validator, parser tanggal/jam, hashing password, RBAC, status promo/film, dedup import, sanitasi, Markdown renderer |
| L2 — Integrasi lokal | **Emulator GAS in-memory** (SpreadsheetApp, CacheService, LockService, PropertiesService, DriveApp, HtmlService) — kode server asli dijalankan tanpa modifikasi | Seluruh aksi API, 25 test case brief, concurrency (simulasi lock), persistence |
| L3 — UI end-to-end | Playwright (Chromium) terhadap klien asli + `google.script.run` yang dijembatani ke emulator L2 | Login/logout, navigasi per role, import end-to-end, filter/search/pagination, upload, responsif (360 px, 768 px, 1280 px, 1920 px), tanpa overflow horizontal |
| L4 — Apps Script nyata | `runSelfTests()` di editor + checklist manual | Kuota, Drive nyata, deployment, performa nyata — **dijalankan oleh Anda** setelah deploy |

---

## 15. Rencana Fase & Gate

| Fase | Hasil | Gate (harus lulus sebelum lanjut) |
|---|---|---|
| **1 Foundation** | Struktur proyek, Schema + init DB + folder Drive, auth & sesi, RBAC, design system CSS, app shell, Dashboard (data nyata), emulator + harness uji | Test 1–5, 22–24 lulus; shell responsif |
| **2 Information Center** | Movie Today, Upcoming, Promo, Import Engine + template | Test 6–15 lulus |
| **3 Knowledge Center** | Layout Bioskop, Layout Mall, Education, Problem & Solving | Test 14–18 untuk modul ini |
| **4 Employee Center** | Directory, profil, CRUD, bulk import, redaksi data | Test 5, 6–10, 18 untuk employee + uji privasi |
| **5 Administration** | User/Role, Announcement, Content Mgmt, Import Mgmt, Audit Logs, Settings, File Mgmt | Test 24–25 + CRUD admin |
| **6 Optimization** | Audit keamanan, profil performa, regresi penuh, panduan & testing report | Semua 25 test case + acceptance criteria |

---

## 16. Batasan yang Diketahui (sejak awal)

1. **Kuota Apps Script** (akun pemilik): ±30 eksekusi simultan, 6 menit/eksekusi, kuota harian Drive/Sheets. Cocok untuk puluhan pengguna aktif bersamaan; untuk ratusan pengguna simultan disarankan migrasi ke Cloud Run + Firestore (jalur sudah disiapkan oleh repository pattern).
2. **Google Sheets**: maks. 10 juta sel per spreadsheet; latensi baca 0,3–1,5 detik saat cache dingin.
3. **Transfer file via `google.script.run`**: praktis ≤ 10 MB per file; video sebaiknya tautan (YouTube unlisted / Drive domain).
4. **Waktu nyata**: tidak ada push real-time; notifikasi diperbarui saat navigasi + polling ringan tiap 2 menit.
5. **Banner Google**: pada akun Gmail non-Workspace dengan akses *Anyone*, Google menampilkan banner "This application was created by another user".
6. **Zona waktu tunggal** per instalasi (default WIB). Outlet WITA/WIT dicatat sebagai pengembangan berikutnya.

---

## 17. Keputusan Terbuka (perlu persetujuan Anda)

1. **Mode autentikasi** — Rekomendasi: `PASSWORD` (custom login) karena tidak semua karyawan dipastikan memiliki akun Workspace. Alternatif: `WORKSPACE` / `HYBRID`.
2. **Video & file besar** — Rekomendasi: video via tautan (YouTube unlisted / Drive terbatas domain), file ≤ 10 MB lewat proxy aman.
3. **Lokasi kode** — Rekomendasi: folder `cinema-hub/` di repositori ini (sekarang) ; dapat dipindah ke repo khusus kapan saja.
4. **Perkiraan jumlah outlet & pengguna aktif bersamaan** — menentukan konfigurasi cache & batas import.
