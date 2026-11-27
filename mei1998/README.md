# MEI 1998 — Part 1/10 (animasi web 9:16)

Animasi sinematik 60 detik yang dirender langsung di browser: canvas 2D, Web Audio API, tanpa library dan tanpa build step.
Semua kode ada di satu file `index.html`, jadi bisa dibuka langsung atau di-deploy sebagai Web App Google Apps Script (`Code.gs`).

## Spesifikasi

| Item | Nilai |
|---|---|
| Rasio / FPS | 9:16 vertikal, 24fps (frame dikuantisasi ke 1/24 dtk) |
| Resolusi | 720×1280 (default) · 1080×1920 dengan `?hd=1` |
| Gaya | garis tinta "boiling" (on twos), palet charcoal/sepia/abu + aksen ember, merah-putih hanya pada bendera |
| Overlay | grain VHS, scanline, tracking glitch, head-switching noise, film flicker, vignette, OSD `▶ PLAY / SP / MEI 14 1998` |

## Timeline shot

| Waktu | Shot | Kamera |
|---|---|---|
| 0–4 dtk | Jam dinding retak, jarum berhenti di 11:00, pantulan api → smash di 3.0 dtk: jam jatuh, percikan api | push-in → handheld shake |
| 4–15.2 | Skyline Jakarta, asap hitam dari ruko & mal, Metromini, Kijang terbakar, siluet berlari | slow pull-back (aerial) |
| 15.2–25 | Halaman kampus senja, 4 jaket almamater + mawar putih, bendera setengah tiang | slow push-in |
| 25–40 | Dinding 13 poster "HILANG", hujan, satu poster lepas & terbang ke gelap | slow push + follow |
| 40–52.2 | TV CRT: siluet di podium, lambang stilistik, siluet mahasiswa menonton | slow push-in |
| 52.2–60.5 | Uang kertas terbakar di tangan gemetar → title card `MEI 1998 — PART 1/10` → `PART 2: Uang yang Tak Lagi Berharga` | push-in + tremor |

## Sound design (disintesis Web Audio, sesuai brief)

- **0–3**: senyap → **3.0** dentum rendah + kaca retak (sinkron dengan smash cut)
- **3–25**: cello drone (D2/A2), sirene jauh, gemeretak api, statis radio dengan gumaman penyiar
- **25–45**: denyut taiko + heartbeat, tempo 60 → 80 bpm, crescendo
- **45–52**: semua jatuh ke senyap kecuali detak jam
- **52–60**: motif piano 4 nada (A minor) dengan ekor reverb

## Kontrol

- **Putar** / **Spasi**: putar atau jeda · **R**: ulang · **C**: subtitle · **N**: narasi
- **Rekam video**: memutar ulang dari 0 dan mengunduh `.mp4` (Chrome terbaru) atau `.webm`, berisi visual + musik/SFX + subtitle
- **Subtitle .srt**: unduh naskah VO bertimecode untuk CapCut / Premiere / DaVinci

> Narasi TTS memakai suara `id-ID` bawaan browser dan **tidak ikut terekam** (keterbatasan `speechSynthesis`).
> Alurnya: rekam video → impor ke editor → timpa dengan VO asli (bariton 35–45 th) memakai file `.srt` sebagai panduan timing.

## Mengedit naskah / timing

- Teks VO dan waktu mulainya ada di array `CUES` (field `say` = ejaan untuk TTS, contoh angka ditulis sebagai kata).
- Batas shot ada di array `SCENES` (`a`/`b` = mulai/selesai, `fin`/`fout` = fade).
- Skor audio diatur di `buildScore()`.

## Catatan konten

Angka dan klaim mengikuti naskah: korban di Klender ditulis "menurut saksi mata", angka >1.200 jiwa mengikuti data Tim Relawan untuk Kemanusiaan yang dikutip laporan TGPF, dan 13 aktivis yang masih hilang.
Tidak ada gore. Tokoh nyata hanya tampil sebagai siluet stilistik, tanpa kemiripan wajah. Uang kertas dibuat generik tanpa potret.
Sebelum publikasi, cocokkan lagi setiap angka dengan sumber primer.
