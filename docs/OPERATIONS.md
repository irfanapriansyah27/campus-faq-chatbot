# Operations Runbook

## Guardrail environment

- Branch `main` adalah satu-satunya sumber deployment Production.
- Production dan staging memakai project Supabase terpisah.
- Verifikasi target project sebelum query atau migration; jangan menentukan
  target dari nama environment saja.
- Jangan menyalin key, database URL, Auth user, FAQ fixture, atau backup antara
  staging dan Production.
- Simpan credential hanya pada secret storage Vercel/Supabase atau credential
  storage OS; jangan taruh di command argument, log, dokumentasi, atau Git.

## Menjalankan aplikasi lokal

```bash
npm ci
cp .env.example .env
npm run dev
curl http://localhost:3000/api/health
```

Gunakan hanya provider/project lokal atau non-Production. `npm start` menjalankan
mode biasa tanpa file watching. Server menangani `SIGINT` dan `SIGTERM`, berhenti
menerima koneksi, dan memberi waktu hingga 10 detik sebelum forced exit.

## Pengujian

```bash
npm test
```

Jalankan suite penuh untuk perubahan runtime, migration, atau dependency. Untuk
perubahan dokumentasi saja, cukup lakukan link check, secret scan, whitespace
check, dan scoped diff review. Baseline rilis Node.js 24 adalah 298/298 PASS.

## Migration

Urutan resmi adalah `001` sampai `005` dalam `supabase/migrations`. Gunakan
Supabase CLI resmi dan proses review berikut:

1. pastikan target ref/environment;
2. buat backup logis dan buktikan recovery lewat restore rehearsal;
3. bandingkan migration history dengan katalog aktual;
4. rehearse repair/apply pada database disposable dari baseline;
5. jalankan dry-run dan cocokkan exact pending set;
6. hentikan pada drift, partial apply, atau output tak terduga;
7. apply satu kali setelah persetujuan write;
8. verifikasi history, ACL/RLS, function/trigger, serta fingerprint data.

Jangan menganggap migration history kosong berarti seluruh SQL aman dijalankan
ulang. Repair history memerlukan bukti bahwa efek katalog sudah ekuivalen.

## Deployment Vercel

1. Merge perubahan terverifikasi ke `main`.
2. Tunggu deployment Production berstatus `Ready`.
3. Verifikasi `GET /api/health` menghasilkan `200`.
4. Untuk perubahan runtime, uji satu jawaban grounded, satu fallback, CORS,
   login/session admin, list FAQ, akses tanpa session, dan logout.
5. Jangan mengubah environment variable sebagai bagian smoke test.

Environment wajib memuat variable pada `.env.example`, kecuali `PORT` dan
`CHATBOT_API_URL` yang tidak diperlukan oleh Vercel. `SUPABASE_URL`, publishable
key, dan service-role key harus berasal dari project yang sama.

## Backup dan recovery

Backup sebelum migration mencakup roles, schema, dan data. Catat ukuran serta
SHA-256 di luar repository, lalu restore ke database disposable yang terisolasi.
Keberadaan file dump saja bukan bukti recovery. Jangan menampilkan isi data atau
connection string dalam evidence.

Rollback deployment aplikasi tidak membatalkan perubahan database. Jika smoke
aplikasi gagal tetapi schema tetap kompatibel, rollback ke deployment Production
terakhir yang diketahui baik. Recovery database harus memakai rehearsal backup,
verifikasi fingerprint, dan persetujuan Production terpisah.

## Pemeriksaan rutin

- `/api/health` mengembalikan `200`;
- FAQ grounded menghasilkan `ANSWER` dengan sumber;
- pertanyaan di luar basis menghasilkan `HANDOFF` tanpa sumber;
- endpoint admin memberi `Cache-Control: no-store`;
- request admin tanpa session ditolak `401`;
- origin asing ditolak CORS;
- jumlah admin aktif sesuai daftar yang disetujui;
- runtime tidak memiliki privilege `DELETE` pada `faq_documents`.

Jangan mencetak secret ketika melakukan pemeriksaan. Laporkan status, count, hash,
dan project ref bila dibutuhkan.
