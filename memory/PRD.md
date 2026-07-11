# PRD — QueueFlow (Aplikasi Antrian Digital Multi-Cabang)

## Problem Statement Asli
Buatkan aplikasi antrian dengan fitur untuk backend, layar monitor, ambil antrian serta pemanggilan. Reusable untuk bank, klinik, rumah sakit atau sejenisnya. Tampilan bagus & responsive, font Poppins.

## Pilihan User
- Admin login sederhana (JWT email+password)
- Pemanggilan dengan suara browser TTS (id-ID)
- Multi-layanan + multi-loket
- Real-time WebSocket
- Monitor tema terang + kolom promosi 16:9 (gambar/video/YouTube)
- Multi-cabang: admin membuat banyak kantor cabang, masing-masing dengan layanan/loket/pengaturan/dashboard sendiri

## Arsitektur
- FastAPI + MongoDB (motor) + WebSocket broadcast (/api/ws, event membawa branch_id)
- React 19 + Tailwind + shadcn + framer-motion + react-fast-marquee, font Poppins
- Auth: JWT (bcrypt, httpOnly cookie + Bearer), admin seeded (admin@antrian.id / admin123, lihat /app/memory/test_credentials.md)

## Data Model
- branches: {id, name, address, active, ticker_text, promo_media[]}
- services: {id, name, prefix, description, icon, active, branch_id}
- counters: {id, name, service_ids, active, branch_id}
- tickets: {id, number, code "A-001", service_id, status waiting|serving|done|skipped, counter_id/name, branch_id, date, created/called/finished_at}
- settings (global): {org_name, tagline, ticker_text fallback, promo_media fallback}
- sequences: nomor urut per layanan per hari

## Halaman
- / Home hub, /login
- /kiosk — pilih cabang (BranchPicker, localStorage kiosk_branch) → ambil tiket
- /monitor — pilih cabang → promo carousel 16:9, nomor dipanggil, status semua loket + antrian yang ditangani, waiting list, ticker, TTS id-ID (toggle suara)
- /operator (protected) — pilih cabang/loket/layanan → panggil/ulang/lewati/selesai
- /admin (protected) — Dashboard (stats per cabang + ringkasan semua cabang), Cabang CRUD, Layanan CRUD, Loket CRUD, Pengaturan (umum + per-cabang: ticker & promo media)

## Sudah Diimplementasikan
- 2026-06: MVP lengkap single-branch (test iteration_1: 15/15 backend pass, frontend pass)
- 2026-06: Redesign monitor tema terang + kolom promosi (gambar/video/YouTube)
- 2026-06: Promo 16:9 + panel Status Loket semua loket
- 2026-06: Multi-cabang penuh + isolasi antar cabang (test iteration_2: 28/28 backend pass, frontend pass)

## Backlog / Next
- P1: Redirect kembali ke halaman asal setelah login (login selalu → /admin)
- P1: Upload gambar promosi langsung (object storage) tanpa URL manual
- P2: Laporan/statistik historis (per hari/minggu) + grafik recharts
- P2: Role terpisah operator vs admin (multi-user per cabang)
- P2: Cetak tiket fisik (printer thermal) / QR tracking posisi antrian
- P2: Pecah Admin.jsx menjadi komponen per-tab
