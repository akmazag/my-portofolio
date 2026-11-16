# CINEMA HUB — Database Schema (Google Sheets)

> Versi skema: **1** · Disimpan di `APP_CONFIG.SCHEMA_VERSION` · Sumber kebenaran di kode: `src/server/data/Schema.js`

## 1. Konvensi

| Aturan | Detail |
|---|---|
| Satu sheet = satu tabel | Nama sheet UPPER_SNAKE_CASE. Baris 1 = header (dibekukan & diproteksi). Data mulai baris 2 |
| Header | `snake_case`, urutan tetap. Kolom baru selalu ditambahkan **di kanan** (migrasi aditif) |
| Primary key | Kolom pertama, string permanen. **Nomor baris tidak pernah dipakai sebagai ID** |
| Format ID | `PREFIX-yyMMdd-XXXXX` (5 karakter base32 acak, cek tabrakan), mis. `PRM-261116-K7Q2M`. Kunci bisnis dari Excel (Movie ID, Employee ID, Promo ID) disimpan apa adanya dan dijaga unik |
| Kolom audit standar ★ | `status`, `created_at`, `created_by`, `updated_at`, `updated_by`, `row_version` |
| Tanggal/waktu | Tanggal: teks `yyyy-MM-dd`. Timestamp: ISO-8601 dengan offset `+07:00`. Disimpan sebagai **teks** agar tidak tergeser locale/zona waktu Sheets |
| Boolean | `TRUE` / `FALSE` |
| Daftar / objek | JSON string (mis. `["FIL-…","FIL-…"]`) atau CSV kode untuk filter sederhana (`outlets`, `target_roles`) |
| Soft delete | Tidak ada penghapusan fisik oleh aplikasi; `status` = `INACTIVE` / `ARCHIVED` |
| Data validation | Kolom enum diberi dropdown (`requireValueInList`), kolom teks berformat `@` (plain text) untuk mencegah formula injection |

★ Pada tabel di bawah, `+ AUDIT` berarti 6 kolom audit standar ditambahkan di akhir.

## 2. Daftar Sheet

| # | Sheet | Kategori | Prefix ID | Keterangan |
|---|---|---|---|---|
| 1 | USERS | Keamanan | `USR` | Akun login |
| 2 | ROLES | Keamanan | kode | Definisi role |
| 3 | PERMISSIONS | Keamanan | kode | Katalog permission |
| 4 | ROLE_PERMISSIONS | Keamanan | `RPM` | **Tambahan** — matriks role × permission (agar role baru tidak mengubah struktur sheet) |
| 5 | SESSIONS | Keamanan | `SES` | **Tambahan** — sesi login (hash token) |
| 6 | OUTLETS | Master | kode | **Tambahan** — master outlet/bioskop |
| 7 | LOOKUPS | Master | `LKP` | **Tambahan** — kategori, genre, jabatan, departemen (dapat diubah admin) |
| 8 | MOVIES | Master | Movie ID | **Tambahan** — master film (pemisahan master–transaksi) |
| 9 | EMPLOYEES | Master | Employee ID | Direktori karyawan |
| 10 | MOVIE_TODAY | Transaksi | `SCH` | Jadwal tayang |
| 11 | UPCOMING_MOVIES | Transaksi | `UPC` | Rencana rilis |
| 12 | PROMOS | Konten | Promo ID | Promo |
| 13 | CINEMA_LAYOUT | Konten | `CLY` | Layout akses publik bioskop |
| 14 | MALL_LAYOUT | Konten | `MLY` | Layout akses publik mall |
| 15 | EDUCATION | Konten | `EDU` | Materi edukasi |
| 16 | PROBLEMS | Konten | `PRB` | Masalah operasional |
| 17 | SOLUTIONS | Konten | `SOL` | Solusi per masalah |
| 18 | ANNOUNCEMENTS | Konten | `ANN` | Pengumuman |
| 19 | COMMENTS | Interaksi | `CMT` | **Tambahan** — komentar/feedback |
| 20 | USER_ACTIVITY | Interaksi | `ACT` | **Tambahan** — bookmark, recently viewed, helpful, progress |
| 21 | NOTIFICATIONS | Interaksi | `NTF` | **Tambahan** — notification center |
| 22 | FILES | Sistem | `FIL` | Registri file Drive |
| 23 | IMPORT_LOGS | Sistem | `IMP` | Riwayat import |
| 24 | AUDIT_LOGS | Sistem | `AUD` | Jejak audit |
| 25 | ERROR_LOGS | Sistem | `ERR` | **Tambahan** — error server (terpisah dari audit) |
| 26 | APP_CONFIG | Sistem | key | Konfigurasi aplikasi (non-rahasia) |

17 sheet wajib dari brief seluruhnya tersedia; 9 sheet tambahan dijelaskan alasannya di kolom keterangan.
Spreadsheet terpisah: **CINEMA_HUB_BACKUP** (backup sebelum REPLACE) dan **CINEMA_HUB_ARCHIVE** (log > 90 hari).

**Script Properties (rahasia / infrastruktur, bukan di sheet):** `SPREADSHEET_ID`, `BACKUP_SPREADSHEET_ID`, `ARCHIVE_SPREADSHEET_ID`, `ROOT_FOLDER_ID`, `FOLDER_IDS` (JSON), `PASSWORD_PEPPER`, `OWNER_EMAIL`, `INSTALLED_AT`.

---

## 3. Definisi Tabel

### 3.1 USERS
| Kolom | Tipe | Wajib | Keterangan |
|---|---|:-:|---|
| user_id | string | ✅ | `USR-…` |
| username | string | ✅ | unik, lowercase, 3–32 karakter `[a-z0-9._]` |
| email | string | ✅ | unik, lowercase |
| full_name | string | ✅ | |
| role_id | enum→ROLES | ✅ | |
| employee_id | ref→EMPLOYEES | | opsional |
| outlet_id | ref→OUTLETS | | untuk target pengumuman |
| area | string | | |
| password_hash | string | ✅ | base64, **tidak pernah dikirim ke klien** |
| password_salt | string | ✅ | base64 |
| password_algo | string | ✅ | `pbkdf2-sha256$2000` |
| must_change_password | bool | ✅ | |
| failed_attempts | int | ✅ | |
| locked_until | timestamp | | |
| last_login_at | timestamp | | |
| + AUDIT | | | `status`: ACTIVE / INACTIVE / LOCKED |

### 3.2 ROLES
`role_id` (SUPER_ADMIN, ADMIN, MANAGEMENT, CINEMA_MANAGER, EMPLOYEE) · `role_name` · `description` · `level` (100/80/60/40/20) · `is_system` (role sistem tidak bisa dihapus) · + AUDIT

### 3.3 PERMISSIONS
`permission_key` (mis. `promo.manage`) · `module` · `action` · `description` · `is_sensitive` (bool) · `status`

### 3.4 ROLE_PERMISSIONS
`rp_id` · `role_id` · `permission_key` · + AUDIT — unik (`role_id`, `permission_key`). Matriks default: lihat Architecture §6.2.

### 3.5 SESSIONS
`session_id` · `token_hash` (SHA-256 hex, unik) · `user_id` · `created_at` · `last_seen_at` · `idle_expires_at` · `absolute_expires_at` · `remember` (bool) · `user_agent` (info saja) · `status` (ACTIVE / REVOKED / EXPIRED) · `revoked_at` · `revoked_reason`

### 3.6 OUTLETS
`outlet_id` (kode, mis. `JKT-GI`) · `outlet_name` · `mall_name` · `city` · `area` · `region` · `address` · `studio_count` · + AUDIT

### 3.7 LOOKUPS
`lookup_id` · `type` · `code` · `label` · `sort_order` · `meta` (JSON, mis. warna badge) · + AUDIT — unik (`type`, `code`).

Tipe awal: `GENRE`, `AGE_RATING` (SU, 13+, 17+, 21+), `PROMO_CATEGORY`, `CINEMA_LAYOUT_CATEGORY` (10 kategori brief), `MALL_LAYOUT_CATEGORY` (10 kategori brief), `EDUCATION_CATEGORY` (10), `EDUCATION_FORMAT`, `PROBLEM_CATEGORY` (11), `ANNOUNCEMENT_CATEGORY`, `DEPARTMENT`, `POSITION`, `EMPLOYMENT_STATUS`.

### 3.8 MOVIES (master)
| Kolom | Tipe | Wajib | Keterangan |
|---|---|:-:|---|
| movie_id | string | ✅ | Movie ID dari Excel, unik |
| title | string | ✅ | |
| genre | csv(GENRE) | ✅ | mis. `ACTION,THRILLER` |
| duration_min | int | ✅ | 1–400 |
| age_rating | enum(AGE_RATING) | ✅ | |
| synopsis | text | | ≤ 2.000 karakter |
| poster_file_id | ref→FILES | | |
| poster_url | url https | | alternatif bila poster eksternal |
| + AUDIT | | | `status`: ACTIVE / ARCHIVED |

### 3.9 MOVIE_TODAY (jadwal)
| Kolom | Tipe | Wajib | Keterangan |
|---|---|:-:|---|
| schedule_id | string | ✅ | `SCH-…` |
| show_date | date | ✅ | |
| movie_id | ref→MOVIES | ✅ | |
| outlet_id | ref→OUTLETS | | kosong = berlaku umum |
| studio | string | ✅ | mis. `Studio 3` / `IMAX` |
| show_time | time `HH:mm` | ✅ | |
| import_id | ref→IMPORT_LOGS | | |
| + AUDIT | | | `status`: ACTIVE / CANCELLED / ARCHIVED |

Kunci duplikasi: `show_date|movie_id|outlet_id|studio|show_time`.

### 3.10 UPCOMING_MOVIES
`upcoming_id` · `movie_id` (ref) · `release_date` (date, wajib) · `upcoming_status` (COMING_SOON / PRESALE / POSTPONED) · `import_id` · + AUDIT — kunci duplikasi: `movie_id`.

### 3.11 PROMOS
| Kolom | Tipe | Wajib | Keterangan |
|---|---|:-:|---|
| promo_id | string | ✅ | Promo ID dari Excel, unik |
| promo_name | string | ✅ | |
| description | text | ✅ | |
| terms | text | | Syarat & ketentuan (baris baru = poin) |
| start_date | date | ✅ | |
| end_date | date | ✅ | ≥ start_date |
| category | enum(PROMO_CATEGORY) | ✅ | |
| image_file_id | ref→FILES | | |
| image_url | url https | | |
| outlets | csv / `ALL` | ✅ | |
| info_link | url https | | |
| import_id | | | |
| + AUDIT | | | `status`: ACTIVE / INACTIVE / ARCHIVED (status efektif dihitung) |

### 3.12 CINEMA_LAYOUT
`layout_id` · `outlet_id` · `category` (CINEMA_LAYOUT_CATEGORY) · `location_name` · `description` · `access_guide` · `operational_instruction` · `special_notes` · `image_file_ids` (JSON) · `diagram_file_ids` (JSON) · `document_file_ids` (JSON) · + AUDIT (`status`: DRAFT / PUBLISHED / ARCHIVED)

### 3.13 MALL_LAYOUT
`layout_id` · `mall_name` · `outlet_id` (bioskop terkait) · `area` (lantai/zona) · `location` · `category` (MALL_LAYOUT_CATEGORY) · `description` · `access_guide` · `image_file_ids` · `layout_file_ids` · `document_file_ids` · + AUDIT

### 3.14 EDUCATION
| Kolom | Tipe | Keterangan |
|---|---|---|
| education_id | string | `EDU-…` |
| title | string | wajib |
| category | enum | wajib |
| format | enum | ARTICLE / PDF / PPT / VIDEO / IMAGE / LINK |
| description | text | ringkasan |
| content_md | text | isi artikel (Markdown, ≤ 45.000 karakter — batas sel 50.000) |
| thumbnail_file_id | ref→FILES | |
| file_id | ref→FILES | materi utama |
| preview_file_id | ref→FILES | PDF hasil konversi PPT (opsional) |
| external_url | url https | video/link |
| author_user_id · author_name | | |
| published_at | timestamp | |
| is_featured | bool | |
| estimated_minutes | int | |
| view_count | int | |
| + AUDIT | | `status`: DRAFT / PUBLISHED / ARCHIVED |

### 3.15 EMPLOYEES
| Kolom | Tipe | Sensitif | Keterangan |
|---|---|:-:|---|
| employee_id | string | | unik |
| full_name | string | | |
| nik | string 16 digit | 🔒 `employee.view_sensitive` | |
| photo_file_id | ref→FILES | | |
| position | enum(POSITION) | | |
| department | enum(DEPARTMENT) | | |
| outlet_id | ref→OUTLETS | | |
| area | string | | |
| email | string | | |
| phone | string | 🔒 `employee.view_contact` | format `+62…` / `08…` |
| join_date | date | | |
| employment_status | enum | | TETAP / KONTRAK / PROBATION / MAGANG |
| + AUDIT | | | `status`: ACTIVE / INACTIVE |

### 3.16 PROBLEMS
`problem_id` · `title` · `category` · `outlet_id` · `description` (PROBLEM) · `symptoms` (SYMPTOM) · `occurred_at` · `media_file_ids` (JSON) · `related_problem_ids` (JSON) · `related_education_ids` (JSON) · `tags` (csv) · `author_user_id` · `author_name` · `accepted_solution_id` · `review_note` · `reviewed_by` · `reviewed_at` · `helpful_count` · `view_count` · + AUDIT (`status`: DRAFT / SUBMITTED / PUBLISHED / REJECTED / ARCHIVED)

### 3.17 SOLUTIONS
`solution_id` · `problem_id` · `root_cause` (ROOT CAUSE) · `steps_json` (SOLUTION: `[{"title":"…","detail":"…"}]`) · `prevention` (PREVENTION) · `is_verified` (bool, terbukti berhasil) · `media_file_ids` · `author_user_id` · `author_name` · `outlet_id` · `review_note` · `reviewed_by` · `reviewed_at` · `helpful_count` · + AUDIT (`status`: SUBMITTED / APPROVED / REJECTED / ARCHIVED)

### 3.18 ANNOUNCEMENTS
`announcement_id` · `title` · `body_md` · `category` · `attachment_file_ids` (JSON) · `publish_at` · `expire_at` · `author_user_id` · `author_name` · `priority` (LOW/NORMAL/HIGH/CRITICAL) · `is_pinned` · `target_roles` (csv / ALL) · `target_areas` (csv / ALL) · `target_outlets` (csv / ALL) · + AUDIT (`status`: DRAFT / PUBLISHED / ARCHIVED)

### 3.19 COMMENTS
`comment_id` · `entity_type` (PROBLEM / SOLUTION / EDUCATION) · `entity_id` · `user_id` · `user_name` · `body` (≤ 1.000) · + AUDIT (`status`: VISIBLE / HIDDEN)

### 3.20 USER_ACTIVITY
`activity_id` · `user_id` · `entity_type` · `entity_id` · `activity_type` (BOOKMARK / VIEW / HELPFUL / READ / PROGRESS) · `value` (mis. persen progress) · `created_at` · `updated_at` — unik (`user_id`, `entity_type`, `entity_id`, `activity_type`), di-*upsert*.

### 3.21 NOTIFICATIONS
`notification_id` · `user_id` · `type` (ANNOUNCEMENT / PROBLEM_REVIEW / IMPORT / SYSTEM) · `title` · `message` · `route` (hash tujuan) · `is_read` · `created_at` · `read_at`

### 3.22 FILES
`file_id` · `drive_file_id` · `module` · `entity_type` · `entity_id` · `original_name` · `mime_type` · `size_bytes` · `sha256` · `folder_key` · `required_permission` · `status` (ACTIVE / ARCHIVED) · `uploaded_by` · `uploaded_at` · `archived_at`

### 3.23 IMPORT_LOGS
`import_id` · `module` · `mode` (APPEND / REPLACE) · `file_name` · `source_file_id` · `total_rows` · `success_rows` · `failed_rows` · `duplicate_rows` · `errors_json` (maks. 200 error pertama) · `backup_ref` · `status` (COMPLETED / PARTIAL / FAILED / ROLLED_BACK) · `started_at` · `finished_at` · `duration_ms` · `executed_by`

### 3.24 AUDIT_LOGS
`audit_id` · `timestamp` · `user_id` · `username` · `role_id` · `action` · `module` · `entity_type` · `entity_id` · `result` (SUCCESS / DENIED / FAILED) · `detail_json` (ringkasan perubahan, tanpa data rahasia) · `session_ref` (6 karakter awal session_id)

### 3.25 ERROR_LOGS
`error_id` · `timestamp` · `user_id` · `action` · `error_code` · `message` · `stack` · `context_json`

### 3.26 APP_CONFIG
`config_key` · `config_value` · `value_type` (string/int/bool/json) · `description` · `is_public` (dikirim ke klien saat bootstrap) · `updated_at` · `updated_by`

Nilai awal:

| Key | Default | Publik |
|---|---|:-:|
| `APP_NAME` | CINEMA HUB | ✅ |
| `APP_TAGLINE` | One Platform. One Knowledge. One Operation. | ✅ |
| `COMPANY_NAME` | (diisi admin) | ✅ |
| `TIMEZONE` | Asia/Jakarta | ✅ |
| `AUTH_MODE` | PASSWORD | |
| `SESSION_IDLE_MINUTES` | 60 | |
| `SESSION_ABSOLUTE_HOURS` | 12 | |
| `SESSION_REMEMBER_DAYS` | 7 | ✅ |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | 5 / 15 | |
| `PASSWORD_MIN_LENGTH` | 8 | ✅ |
| `IMPORT_MAX_ROWS` / `IMPORT_MAX_FILE_MB` | 5000 / 5 | ✅ |
| `UPLOAD_MAX_MB_IMAGE` / `_DOCUMENT` / `_VIDEO` | 5 / 10 / 10 | ✅ |
| `PAGE_SIZE_CARDS` / `PAGE_SIZE_TABLE` | 12 / 20 | ✅ |
| `LOG_RETENTION_DAYS` | 90 | |
| `SCHEMA_VERSION` | 1 | |

---

## 4. Relasi

```
ROLES 1─* ROLE_PERMISSIONS *─1 PERMISSIONS
ROLES 1─* USERS 1─* SESSIONS
USERS 0..1─1 EMPLOYEES *─1 OUTLETS
MOVIES 1─* MOVIE_TODAY *─0..1 OUTLETS
MOVIES 1─0..1 UPCOMING_MOVIES
PROBLEMS 1─* SOLUTIONS ;  PROBLEMS *─* EDUCATION (related_education_ids)
FILES *─1 (entity_type, entity_id)   — polimorfik ke semua tabel konten
COMMENTS / USER_ACTIVITY *─1 (entity_type, entity_id)
```

## 5. Inisialisasi & Migrasi

`setupCinemaHub()` (dijalankan dari editor, idempoten):
1. Membuat / menemukan spreadsheet utama, backup, dan arsip → simpan ID di Script Properties.
2. Untuk setiap tabel di `Schema.js`: buat sheet bila belum ada; bila sudah ada, **tambahkan kolom yang hilang di kanan** — tidak pernah menghapus/menimpa data, tidak mengubah urutan kolom lama.
3. Format header (bold, freeze, protect), format kolom teks `@`, dropdown validasi enum.
4. Seed data referensi bila kosong: ROLES, PERMISSIONS, ROLE_PERMISSIONS, LOOKUPS, APP_CONFIG (hanya key yang belum ada).
5. Membuat struktur folder Drive (hanya yang belum ada).
6. Membuat SUPER ADMIN awal bila belum ada satu pun user → password sementara ditampilkan **sekali** di log eksekusi, wajib diganti saat login pertama.
7. Memasang trigger harian (status promo, sesi kedaluwarsa) dan bulanan (arsip log).
8. Menulis `SCHEMA_VERSION`.

`seedDemoData()` — data dummy uji (5 outlet, 20 film, 60 jadwal, 15 promo termasuk yang expired, 30 karyawan, 20 materi, 15 problem, 8 pengumuman, 1 user per role). Hanya berjalan bila `APP_CONFIG.ENVIRONMENT = DEMO`.

## 6. Rencana (di luar rilis 1)

`QUIZZES` (`quiz_id`, `education_id`, `questions_json`, `pass_score`) dan `QUIZ_ATTEMPTS` (`attempt_id`, `quiz_id`, `user_id`, `score`, `answers_json`, `submitted_at`).
