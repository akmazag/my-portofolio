# QC Management System v2.0 — Google Apps Script

Aplikasi QC terintegrasi (Workforce Mapping, Cleaning Compliance, Visit Management,
Digital Checklist, QC Grading) berbasis **Google Apps Script + Google Sheets**.

- Laporan audit & daftar perbaikan: [`docs/AUDIT.md`](docs/AUDIT.md)
- Kode sumber Apps Script: [`src/`](src) (salin apa adanya ke project Apps Script)

## Struktur

```
src/
  Code.gs               Entry point Web App (doGet, include)
  Config.gs             Konstanta, SCHEMA sheet, alias header, default APP_CONFIG
  ConfigService.gs      Baca/tulis APP_CONFIG (cache)
  SheetRepository.gs    Data Access Layer: header mapping, selective fetching, batch write
  CacheEngine.gs        Booster cache berbasis versi data + chunking
  SessionService.gs     Sesi, hash password bersalt, revokasi sesi, rate limit login
  AccessControl.gs      Role & scope engine (server-side)
  ResponseService.gs    run_/runPublic_/withLock_, format response standar
  ValidationService.gs  Validasi & sanitasi input
  AuditLogService.gs    Audit trail
  AuthService.gs        Login/logout/bootstrap/manajemen user
  OrganizationService.gs Roster QC Area, mapping, master KODE/OP, APP_CONFIG API
  CleaningService.gs    Engine interval cleaning (semua view dalam 1 request)
  VisitService.gs       Jadwal, status efektif, timeline, coverage/achievement
  ChecklistService.gs   Master checklist, submit, PDF bukti
  GradingService.gs     Grading Σ/Σ, ranking, temuan, detail QC Area
  DashboardService.gs   KPI eksekutif
  DriveService.gs       PDF privat di Google Drive
  SetupService.gs       Menu admin, setup non-destruktif, audit kualitas data
  *.html                Frontend (Bootstrap 5, Chart.js, Plus Jakarta Sans)
tools/                  Mock runtime Apps Script + uji backend & UI (Node.js, opsional)
```

## Instalasi (spreadsheet yang sudah ada)

1. **Backup** spreadsheet (File → Make a copy).
2. Buka spreadsheet → Extensions → Apps Script. Hapus file lama, lalu buat file dengan nama
   yang sama seperti di `src/` (`.gs` = Script, `.html` = HTML) dan salin isinya.
   Alternatif: `clasp push` dengan `rootDir: src` (manifest `src/appsscript.json` sudah disertakan).
3. Project Settings → **Time zone: Asia/Jakarta**.
4. Muat ulang spreadsheet → menu **⚙️ QC Admin**:
   1. **Setup / Perbaiki Struktur Database** — non-destruktif: hanya menambah sheet/kolom yang
      belum ada (`MASTER_CHECK.Aspek`, `CHECKLIST_HEADER.KodeOutlet/StatusDokumen`,
      `AUDIT_LOG.Role`) dan menyalin item dari sheet lama `MASTER CHECK`.
   2. **Hash Seluruh Password Plaintext**.
   3. **Audit Kualitas Data** → perbaiki temuan di sheet `AUDIT_DATA`
      (minimal: tambah Class **A** dan perbaiki nilai kursi Class **B** di sheet `INTERVAL`).
   4. (Bila pernah memakai v1) **Cabut Akses Publik File PDF Lama**.
5. Deploy → **New deployment → Web app**:
   - Execute as: **Me** (wajib — user tidak perlu akses ke Sheet/Drive)
   - Who has access: Anyone / Anyone within your domain (login ditangani aplikasi)

## Aturan akses (ringkas)

| Role (kolom `Users.Role`) | Scope default (bila `AksesData` kosong) |
|---|---|
| QC / QC Office / Admin | Seluruh outlet |
| RM | `KODE.RM` = Nama user |
| AM | `KODE.AM` = Nama user |
| Outlet | `Users.KodeOutlet` (atau Username = kode outlet) |
| QC Area | `KODE.KabagQCArea` = Nama user (+ penugasan `OP.OUTLET`) |
| Specialist / Kabag | `KODE.KabagQCArea` = Nama user |

`AksesData` (opsional) **menggantikan** default: `ALL`, `AREA:<area>`, `RM:<nama>`, `AM:<nama>`,
`KABAG:<nama>`, `OUTLET:<kode>` — dipisah koma. Mapping kosong = akses ditolak (bukan semua data).

## Konfigurasi (sheet APP_CONFIG)

`warning_threshold_days`, `grade_A_min`…`grade_D_min`, `grading_method` (`ratio`/`average`),
`pdf_required`, `visit_period_months`, `upcoming_visit_days`, `max_pdf_mb`, `session_ttl_hours`,
`maintenance_mode`. Dapat diubah dari menu **Pengaturan** (Admin), tervalidasi & tercatat di audit.

## Pengujian lokal (opsional, untuk developer)

```bash
# ekspor workbook ke JSON {sheet: [[...]]} lalu:
QC_DATA_JSON=/path/qcdata.json node tools/test-backend.js        # 63 uji backend
QC_DATA_JSON=/path/qcdata.json OUT_DIR=/tmp/shots node tools/e2e-ui.js   # 22 uji UI (Playwright)
```

Data workbook berisi data pribadi — **jangan di-commit** ke repository.
