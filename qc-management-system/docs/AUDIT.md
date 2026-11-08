# Laporan Audit & Perbaikan — QC Management System v2.0.0

Audit dilakukan terhadap kode `AccessControl_fixed.zip` (v1.0.0) dan struktur workbook
`QC_MONITORING.xlsx`. Seluruh perbaikan diverifikasi dengan **63 uji integrasi backend** dan
**22 uji end-to-end UI** (Chromium, desktop + mobile) memakai data workbook asli.

---

## 1. Bug kritis yang ditemukan (v1) dan sudah diperbaiki

| # | Modul | Masalah di v1 | Dampak | Perbaikan v2 |
|---|-------|---------------|--------|--------------|
| 1 | Dashboard, Grading | Fungsi `round_()` dipanggil tetapi **tidak pernah didefinisikan** | Dashboard & menu Performa **error** segera setelah ada 1 checklist | `round_()` ditambahkan di `SheetRepository.gs` |
| 2 | Checklist | `uploadPDF_()` mengembalikan `idDocument`, checklist membaca `docResult.documentId` | ID PDF **tidak pernah tersimpan** — dokumen tidak tertaut ke Visit ID | Diperbaiki + status dokumen terpisah (`StatusDokumen`) |
| 3 | Checklist | Sheet `MASTER_CHECK` kosong; 57 item ada di sheet lama `MASTER CHECK` (format berbeda) | Form checklist **tidak menampilkan item apa pun** | Fallback otomatis + migrasi ke `MASTER_CHECK` (ID deterministik, kolom `Aspek`) |
| 4 | Checklist | Frontend mengirim kategori `FnB`, data memakai `F&B` | Item F&B tidak pernah muncul | Normalisasi kategori `F&B/FnB/FB` di server |
| 5 | Auth | Kolom sheet `Password`, kode menulis ke `PasswordHash` (kolom baru) & `apiChangePassword` hanya membaca `PasswordHash` | Ganti password gagal; password plaintext tetap tersimpan | Satu kolom `Password` berisi hash bersalt; migrasi otomatis saat login |
| 6 | Auth / Setup | Menu "Reset Admin" menulis password default yang tertanam di kode, dalam bentuk **plaintext**; fungsi menu berakhiran `_` | Celah keamanan; menu error "Script function not found" | Reset via dialog (tanpa password bawaan), nama fungsi publik |
| 7 | Scope | Format `AREA:BEKASI 1, …` di `Users.AksesData` tidak dikenali; QC Area dicari di `OP.OUTLET` yang kosong | Akun QC Area **tidak melihat outlet apa pun** | Parser token `ALL/AREA/RM/AM/KABAG/OUTLET` + default `KODE.KabagQCArea` (PRD §3.4) |
| 8 | Drive | PDF dibagikan **"Anyone with link"** | Dokumen dapat dibuka siapa saja yang memiliki tautan | File privat; dibuka via `apiGetDocumentFile` setelah cek sesi + scope. Menu untuk mencabut sharing file lama |
| 9 | Dashboard | Aktivitas audit seluruh user dikirim ke semua role | Kebocoran data lintas user | Non-admin hanya melihat aktivitasnya sendiri |
| 10 | Grading | "Temuan item" membaca **seluruh** CHECKLIST_DETAIL tanpa filter scope | Kebocoran data lintas region/outlet | Hanya checklist yang lolos scope & filter |
| 11 | Grading detail | Filter visit memakai kolom `Outlet` (tidak ada di LOG_VISIT) | KPI kunjungan QC Area selalu 0 | Relasi via Kode Outlet |
| 12 | Organisasi | Personel OP tanpa kolom OUTLET dibuang | 26 personel QC Area **tidak tampil**; detail personel kosong (nama field tidak cocok) | Roster gabungan OP + KODE.KabagQCArea + USERS |
| 13 | Cleaning | `INTERVAL` class A tidak ada & class B kursi berisi tanggal → interval 0 → status **"OK"** | Outlet yang tidak punya standar terlihat patuh | Status baru **"No Interval"** + temuan audit |
| 14 | Cleaning | Relasi pakai Nama Outlet; jenis `Kursi`/`Karpet`/`Cuci Karpet` tidak seragam | Riwayat lama tidak terhitung / salah cocok | Relasi Kode Outlet + normalisasi jenis |
| 15 | Cache | Invalidasi hanya cache milik pelaku + registry key ditulis ke ScriptProperties tiap `cacheSet_` | Data user lain basi s.d. 5 menit; kuota properties & race condition | Cache berbasis **versi data** per modul (PRD §6.1) + chunking > 100 KB |
| 16 | Sesi | Akun yang dinonaktifkan tetap bisa memakai sesi aktif s.d. 6 jam | Pelanggaran PRD §13.1 #10 | Sesi divalidasi ke indeks USERS; nonaktif = langsung keluar |
| 17 | Lock | `auditLog_` memakai ScriptLock yang sama dengan operasi utama | Audit sering terlewat | Audit tanpa lock (appendRow atomik) |
| 18 | Setup | `ensureSheet_` **menimpa header** bila sel A1 berbeda; `getSheetByName('USERS')` vs sheet `Users` | Risiko merusak struktur existing | Setup non-destruktif: hanya menambah kolom yang belum ada di kanan |
| 19 | UI | Tombol aksi tampil untuk semua role; sidebar mobile tidak bisa disembunyikan | UX membingungkan, layout mobile rusak | Tombol mengikuti izin, drawer mobile, popup panduan, viewer PDF |
| 20 | Duplikasi | `getPdfFolder_` & `setupDatabaseUi` didefinisikan dua kali | Perilaku tidak pasti | Satu definisi |

## 2. Temuan kualitas data pada QC_MONITORING.xlsx

Hasil menu **QC Admin → Audit Kualitas Data** pada workbook yang dikirim:

| Tingkat | Sheet | Temuan | Tindakan yang disarankan |
|---------|-------|--------|--------------------------|
| KRITIS | INTERVAL | Class **A** (31 outlet) belum ada | Tambahkan baris `A | <bulan kursi> | <bulan karpet>` |
| KRITIS | INTERVAL | `BulanCuciKursi` class **B** berisi tanggal `2026-05-03` (bukan angka) | Ubah format sel ke Number lalu isi jumlah bulan |
| KRITIS | Users | **Seluruh 5 password** akun tersimpan plaintext | Menu "Hash Seluruh Password Plaintext" (juga otomatis ter-hash saat user login) |
| TINGGI | KODE | **201 dari 273** outlet belum punya `KabagQCArea` | Tetapkan lewat Organisasi → Detail → Edit |
| SEDANG | INTERVAL | Class A+ tercatat dua kali | Hapus baris duplikat |
| SEDANG | OP | 24 personel QC Area belum punya outlet | Tetapkan penugasan |
| RENDAH | Users | 1 akun Outlet tanpa Nama; 1 Kabag QC Area (21 outlet) belum punya akun login | Lengkapi |
| RENDAH | TRANSAKSI_CLEANING | Variasi jenis (`Kursi`, `Karpet`, `Cuci Karpet`) | Sudah dinormalisasi sistem |

> Selama Class A/B belum diperbaiki, 170 outlet berstatus **No Interval** — ini disengaja agar
> outlet tanpa standar tidak terlihat "patuh".

## 3. Keputusan atas pertanyaan terbuka PRD §14

Dibuat **dapat dikonfigurasi** agar tidak mengunci business logic secara sepihak:

| Pertanyaan | Implementasi v2 | Cara mengubah |
|-----------|-----------------|---------------|
| Scope AM | Default kolom `KODE.AM` = Nama user; atau token `AREA:` di AksesData | Kolom AksesData |
| Scope Specialist | Default `KODE.KabagQCArea` = Nama; atau token di AksesData | Kolom AksesData |
| Dasar interval cleaning | Tanggal cuci terakhir per outlet + studio + jenis + interval Class (logika v1 dipertahankan) | — |
| Target kunjungan | Setiap outlet minimal 1× per periode; default 3 bulan | `APP_CONFIG.visit_period_months` |
| Kategori per kunjungan | Boleh lebih dari satu, digabung tanpa duplikasi | — |
| Rumus grading QC Area | **Σ skor aktual / Σ skor maksimum** (PRD §10.3) | `APP_CONFIG.grading_method = ratio / average` |
| PDF wajib untuk grading | Tidak (checklist tetap dihitung, ditandai "Belum ada PDF") | `APP_CONFIG.pdf_required = true` |
| Definisi "OR" cleaning | Logika v1 dipertahankan (target = TargetInterval, default 1) — **belum dikunci** | Perlu konfirmasi bisnis |

## 4. Hal yang perlu dikonfirmasi / di luar cakupan

1. Definisi **OR** pada Comparison OR (PRD §9.3).
2. Hak **edit mapping** untuk RM/AM/QC Area/Specialist (PRD §5.6, "E*"): saat ini hanya Admin
   yang dapat menulis master — role lain read-only (lebih aman sampai aturannya dikunci).
3. Export Excel/PDF (PRD §9.6) belum dibuat.
4. Sheet `DB RM`, `DB AM`, `DB OPERATION`, `DB LND`, `Sheet5`, `Sheet10`, `Sheet16`, `TRANSAKSI_QC`
   tidak dipakai aplikasi dan tidak diubah. `Sheet5` berisi email & nomor telepon — pertimbangkan
   membatasi akses spreadsheet.
