# CINEMA HUB — Design System

> Karakter: **premium SaaS × cinema branding**. Navigasi tenang ala Linear, ruang baca ala Notion, minimalisme ala Apple.
> Gelap & sinematik hanya di area brand (sidebar, login, hero); area kerja terang, bersih, dan mudah dibaca karyawan non-IT.

## 1. Prinsip

1. **Konten adalah bintang.** Poster, banner, dan foto layout tampil besar; chrome UI netral.
2. **Satu aksi utama per layar.** Tombol primer maksimal satu di setiap area.
3. **Hierarki tegas, dekorasi minimal.** Bedakan dengan ukuran, berat, dan ruang — bukan warna berlebih.
4. **Konsisten di semua halaman.** Semua halaman dibangun dari komponen yang sama; tidak ada gaya ad-hoc.
5. **Status selalu jelas.** Loading = skeleton, kosong = empty state dengan aksi, error = pesan + "Coba lagi".
6. **Aksesibel.** Kontras teks ≥ 4,5:1 (WCAG AA), target sentuh ≥ 40 px, fokus terlihat, navigasi keyboard.

## 2. Warna (design tokens)

### 2.1 Brand
| Token | Hex | Penggunaan |
|---|---|---|
| `--ch-navy-950` | `#070B1F` | Latar login & hero paling gelap |
| `--ch-navy-900` | `#0B1230` | **Primary** — sidebar, header brand |
| `--ch-navy-800` | `#141C45` | Hover item sidebar, kartu di area gelap |
| `--ch-navy-700` | `#1E2860` | Border di area gelap |
| `--ch-blue-600` | `#2F5BFF` | **Secondary / Electric Blue** — tombol primer, link aktif, fokus |
| `--ch-blue-700` | `#1D44E0` | Hover/pressed tombol primer, teks link |
| `--ch-blue-50` | `#EBF0FF` | Latar badge/selected row |
| `--ch-violet-500` | `#7C5CFF` | **Aksen** — gradien brand, ilustrasi, highlight "Featured" (bukan teks kecil) |
| `--ch-cyan-400` | `#22D3EE` | **Aksen** — indikator "Sedang Tayang", glow spotlight |

Gradien brand (hanya login, hero dashboard, kartu featured): `linear-gradient(135deg, #2F5BFF 0%, #7C5CFF 100%)`.

### 2.2 Netral (light)
| Token | Hex | Penggunaan | Kontras vs putih |
|---|---|---|---|
| `--ch-bg` | `#F4F6FB` | Latar halaman | — |
| `--ch-surface` | `#FFFFFF` | Kartu, tabel, modal | — |
| `--ch-surface-2` | `#F8FAFD` | Header tabel, input disabled | — |
| `--ch-border` | `#E3E8F2` | Garis pemisah, border kartu | — |
| `--ch-border-strong` | `#CBD3E3` | Border input | — |
| `--ch-text` | `#0F172A` | Teks utama | 17,9 : 1 |
| `--ch-text-2` | `#475569` | Teks sekunder | 7,6 : 1 |
| `--ch-text-3` | `#64748B` | Meta, placeholder, caption | 4,8 : 1 |

### 2.3 Semantik
| Token | Hex | Latar lembut | Penggunaan |
|---|---|---|---|
| `--ch-success` | `#15803D` | `#E8F7EE` | Aktif, berhasil, terverifikasi |
| `--ch-warning` | `#B45309` | `#FEF4E6` | Akan berakhir, menunggu jadwal, review |
| `--ch-danger` | `#B91C1C` | `#FDECEC` | Expired, error, ditolak, hapus |
| `--ch-info` | `#0E7490` | `#E6F6FA` | Informasi, upcoming |

Semua warna teks semantik ≥ 5 : 1 terhadap putih.

### 2.4 Dark mode
Disiapkan sejak awal melalui token yang sama (`[data-theme="dark"]` + `prefers-color-scheme`), toggle di menu profil.

| Token | Dark |
|---|---|
| `--ch-bg` | `#0B1020` |
| `--ch-surface` | `#121933` |
| `--ch-surface-2` | `#18213F` |
| `--ch-border` | `#232D52` |
| `--ch-text` | `#E6EAF5` (15,7 : 1) |
| `--ch-text-2` | `#B4BCD3` |
| `--ch-text-3` | `#97A0B8` (7,3 : 1) |
| `--ch-blue-600` | `#5B8CFF` (6,0 : 1) |

## 3. Tipografi

Font: **Inter** (Google Fonts, 400/500/600/700), fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Angka tabel: `font-variant-numeric: tabular-nums`.

| Token | Ukuran / line-height | Weight | Penggunaan |
|---|---|---|---|
| `display` | 36 / 44 | 700, tracking −0,02em | Hero login |
| `h1` | 28 / 36 | 700, −0,015em | Judul halaman |
| `h2` | 22 / 30 | 600 | Judul seksi |
| `h3` | 18 / 26 | 600 | Judul kartu besar, modal |
| `h4` | 16 / 24 | 600 | Judul kartu |
| `body` | **15 / 24** | 400 | Teks utama (nyaman untuk karyawan non-IT) |
| `body-sm` | 14 / 20 | 400/500 | Tabel, form, menu |
| `caption` | 13 / 18 | 500 | Meta, label |
| `overline` | 12 / 16 | 600, uppercase, +0,06em | Label grup sidebar, kategori |

Maksimal lebar baca artikel: **72ch**. Mobile: `h1` 24/32, `display` 28/36.

## 4. Spasi, Radius, Bayangan, Gerak

- **Spasi** (basis 4 px): `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32 · `--sp-10` 40 · `--sp-12` 48 · `--sp-16` 64
- **Radius:** `--r-sm` 6 (badge, input kecil) · `--r-md` 10 (input, tombol) · `--r-lg` 14 (kartu) · `--r-xl` 20 (modal, hero) · `--r-full` (avatar, chip)
- **Bayangan (lembut, kebiruan):**
  - `--shadow-1` `0 1px 2px rgba(15,23,42,.06)` — kartu diam
  - `--shadow-2` `0 4px 12px rgba(15,23,42,.08)` — hover kartu, dropdown
  - `--shadow-3` `0 16px 40px rgba(15,23,42,.16)` — modal, drawer
  - `--glow-blue` `0 0 0 4px rgba(47,91,255,.18)` — focus ring
- **Gerak:** 150 ms (hover), 200 ms (dropdown/toast), 260 ms (modal/drawer), easing `cubic-bezier(.2,.8,.2,1)`. Menghormati `prefers-reduced-motion`.

## 5. Layout & Grid

| Elemen | Spesifikasi |
|---|---|
| Sidebar | 264 px (desktop) · collapsible ke 76 px (ikon) · drawer overlay di < 1024 px |
| Topbar | 64 px, sticky, latar surface + blur, berisi: toggle menu, breadcrumb, global search (⌘/Ctrl + K), notifikasi, menu profil |
| Konten | max-width 1440 px, padding 32 px (desktop) / 24 px (tablet) / 16 px (mobile) |
| Grid kartu | CSS Grid `repeat(auto-fill, minmax(var(--card-min), 1fr))`, gap 20 px |

Breakpoints: `sm` 480 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536.
Aturan: **tidak ada overflow horizontal** pada 320–1920 px. Tabel lebar → di mobile berubah menjadi daftar kartu (bukan scroll halaman); hanya kontainer tabel yang boleh scroll horizontal pada tablet.

### Ukuran kartu konsisten
| Kartu | `--card-min` | Rasio media |
|---|---|---|
| Movie (poster) | 200 px | 2 : 3 |
| Upcoming (poster besar) | 240 px | 2 : 3 |
| Promo | 300 px | 16 : 9 |
| Layout (galeri) | 280 px | 4 : 3 |
| Education | 280 px | 16 : 9 thumbnail |
| Employee | 240 px | avatar 72 px |
| Problem | 340 px | tanpa media (ikon kategori) |
| Stat (dashboard) | 220 px | — |

Judul kartu dibatasi 2 baris, deskripsi 3 baris (`line-clamp`) agar tinggi kartu dalam satu baris seragam.

## 6. Ikon

Satu set ikon garis (gaya Lucide, ISC license) di-*inline* sebagai **SVG sprite** — tanpa request eksternal, ukuran 20 px (UI) / 16 px (inline teks) / 24 px (empty state), stroke 1,75, `currentColor`.
Pemetaan menu: Dashboard `layout-dashboard` · Movie `clapperboard` · Upcoming `calendar-clock` · Promo `ticket-percent` · Cinema Layout `map` · Mall Layout `building-2` · Education `graduation-cap` · Problem & Solving `life-buoy` · Employee `users` · Announcement `megaphone` · Admin `shield-check`.

## 7. Komponen

| Komponen | Varian / perilaku kunci |
|---|---|
| **Button** | `primary` (blue), `secondary` (surface + border), `ghost`, `danger`; ukuran sm 32 / md 40 / lg 48; state loading (spinner + disabled), ikon kiri opsional |
| **Input / Select / Textarea** | Label di atas, helper & pesan error di bawah, ikon prefix opsional, `aria-invalid`, fokus `--glow-blue` |
| **Password** | Tombol tampil/sembunyi (ikon mata) dengan `aria-pressed` |
| **Search bar** | Debounce 300 ms, tombol clear, shortcut ⌘/Ctrl+K untuk global search (command palette berisi hasil per modul) |
| **Filter bar** | Search + select + chip filter aktif yang bisa dihapus + "Reset filter"; filter disimpan di URL hash (bisa dibagikan & bertahan saat refresh) |
| **Card** | Header (judul, meta), media, body, footer aksi; hover naik 2 px + `--shadow-2`; seluruh kartu dapat diklik (dengan elemen `<a>`/`<button>` yang benar) |
| **Badge** | `neutral`, `blue`, `success`, `warning`, `danger`, `info`, `violet`; untuk status, rating usia, kategori |
| **Rating usia** | Badge khusus: SU (hijau), 13+ (biru), 17+ (oranye), 21+ (merah) |
| **Data table** | Header sticky, sort per kolom, row hover, aksi baris di menu `⋯`, pagination, pilihan jumlah baris, mode kartu di mobile |
| **Pagination** | "Menampilkan 1–20 dari 248", tombol sebelumnya/berikutnya, nomor halaman ringkas |
| **Modal** | Ukuran sm 420 / md 640 / lg 880 / full (mobile = sheet dari bawah); focus trap; Esc menutup; konfirmasi destruktif mengharuskan mengetik kata kunci (mis. `REPLACE`) |
| **Drawer** | Panel kanan 480 px untuk detail cepat (film, karyawan) |
| **Toast** | Kanan atas (desktop) / bawah (mobile); success 4 dtk, error tetap sampai ditutup; maksimal 3 bertumpuk |
| **Skeleton** | Bentuk mengikuti komponen asli (poster, baris tabel, teks) dengan shimmer halus |
| **Empty state** | Ikon 24 px dalam lingkaran, judul, penjelasan singkat, aksi utama (mis. "Import jadwal") jika user berhak |
| **Error state** | Pesan manusiawi + ID error + "Coba lagi" |
| **Forbidden state** | "Anda tidak memiliki akses ke halaman ini" + kembali ke Dashboard |
| **Breadcrumb** | `Movie Center / Movie Today`; di mobile hanya induk terakhir dengan panah kembali |
| **Notification center** | Dropdown 380 px, tab "Semua / Belum dibaca", tandai semua dibaca |
| **User menu** | Avatar inisial/foto, nama, role, Profil saya, Ganti password, Tema, Keluar |
| **Countdown** | Hari · jam · menit, monospace tabular, berubah warna `warning` < 3 hari |
| **Stepper** | Untuk import 9 langkah (diringkas jadi 4 tahap visual: File → Validasi → Konfirmasi → Hasil) dan langkah solusi |
| **Tabs / Segmented** | Movie Overview ↔ Detailed Schedule; Aktif ↔ Riwayat promo |

## 8. Pola Halaman

- **Header halaman:** judul (h1) + deskripsi singkat 1 baris + aksi kanan (mis. "Import", "Tambah"). Aksi admin hanya dirender bila punya permission (backend tetap memvalidasi).
- **Login:** layout terbelah. Kiri (≥ 1024 px): panel navy-950 dengan efek *spotlight* radial biru-violet, motif film-strip tipis (CSS), logo, tagline, 3 poin nilai. Kanan: kartu form putih 420 px — logo kecil, "Masuk ke CINEMA HUB", username/email, password (show/hide), "Ingat saya", tombol primer penuh, pesan error inline, info bantuan admin. Mobile: panel brand menjadi header ringkas di atas form.
- **Dashboard:** salam berdasarkan waktu ("Selamat pagi, Rina") + tanggal & jam live → banner pengumuman CRITICAL (bila ada) → baris stat (Film hari ini, Jadwal tayang, Promo aktif, Materi baru) → "Sedang tayang hari ini" (carousel poster) → grid 2 kolom: Pengumuman terbaru | Promo aktif → Upcoming → Materi edukasi terbaru | Problem & solving terbaru → Quick access (ikon modul sesuai permission).
- **Detail konten:** kolom utama (konten) + kolom samping (meta, lampiran, terkait) di desktop; bertumpuk di mobile.

## 9. Bahasa & Mikrokopi

- Bahasa Indonesia baku yang ramah dan ringkas; istilah operasional bioskop yang sudah umum boleh tetap Inggris (Concession, Lobby, Ticketing, F&B).
- Tombol menggunakan kata kerja: "Simpan", "Import data", "Terbitkan", "Nonaktifkan".
- Format tanggal: `Senin, 16 Nov 2026` · jam `14:30` · angka `1.250` · durasi `2 j 15 m`.
- Pesan error menjelaskan solusi: "Kolom *Jam Tayang* baris 12 harus berformat JJ:MM, contoh 19:30."

## 10. Aksesibilitas (checklist)

- Kontras teks memenuhi tabel di atas; `--ch-violet-500` tidak dipakai untuk teks < 18 px.
- Semua kontrol dapat dijangkau keyboard; urutan fokus logis; skip-link "Lewati ke konten".
- `aria-live="polite"` untuk toast & hasil pencarian; `role="dialog"` + `aria-modal` untuk modal.
- Gambar konten memiliki `alt` (judul film/promo/lokasi); ikon dekoratif `aria-hidden`.
- Status tidak hanya dibedakan warna (selalu ada teks/ikon).
