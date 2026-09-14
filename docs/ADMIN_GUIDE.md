# Admin Guide

Admin Console Production tersedia di
[campus-faq-chatbot-nu.vercel.app/admin](https://campus-faq-chatbot-nu.vercel.app/admin).

## Masuk dan keluar

1. Buka `/admin` pada domain environment yang dituju.
2. Masukkan email dan password Supabase Auth Anda.
3. Setelah login, backend memastikan akun tercantum sebagai admin aktif.
4. Gunakan tombol **Keluar** ketika selesai. Logout mencabut session bila
   memungkinkan dan selalu membersihkan cookie lokal.

Jangan berbagi akun atau memasukkan credential pada chat, issue, PR, maupun log.
MFA belum tersedia, sehingga password manager dan kebijakan akses organisasi
tetap diperlukan.

## Daftar FAQ

Halaman utama menampilkan FAQ dengan pencarian, filter status/kategori, sorting,
pagination, dan total hasil. Hanya FAQ `published` yang digunakan chatbot.

## Membuat FAQ

1. Pilih **Tambah FAQ**.
2. Isi key unik, pertanyaan, jawaban, kategori, sumber, dan metadata yang relevan.
3. Mulai dari `draft` untuk review atau pilih `published` hanya jika konten sudah
   disetujui.
4. Simpan. Backend membuat embedding dari pertanyaan dan jawaban.

Jangan memakai `knowledge/faqs.sample.json` sebagai konten Production. Sumber
harus menunjuk dokumen kampus yang resmi dan masih berlaku.

## Memperbarui FAQ

Perubahan memakai optimistic concurrency. Jika orang lain telah mengubah record,
Admin Console menampilkan konflik version; muat ulang dan tinjau versi terbaru
sebelum mencoba lagi. Perubahan pertanyaan/jawaban memperbarui canonical content
dan embedding. Trigger database menaikkan `version` dan `updated_at`.

## Lifecycle

| Status | Muncul di chatbot | Tindakan umum |
|---|---|---|
| `draft` | Tidak | Review dan perbaikan |
| `published` | Ya | Konten resmi yang aktif |
| `archived` | Tidak | Konten yang ditarik tetapi dipertahankan |

Gunakan **Arsipkan** untuk menarik FAQ. Aplikasi tidak mempunyai hard delete dan
runtime tidak memiliki privilege `DELETE`. FAQ archived dapat dipulihkan ke
`draft`, lalu ditinjau sebelum diterbitkan lagi. Hard delete hanya untuk prosedur
pemeliharaan khusus dengan backup dan persetujuan terpisah.

## Penanganan masalah

- **Credential invalid (`401`)**: periksa email/password pada environment yang
  benar tanpa membagikannya kepada orang lain.
- **Admin forbidden (`403`)**: Auth user valid tetapi membership admin tidak ada
  atau tidak aktif; hubungi operator database.
- **Session berakhir**: login kembali; jangan mengubah cookie secara manual.
- **Konflik version (`409`)**: muat ulang FAQ dan ulangi edit dari versi terbaru.
- **Provider gagal (`503`)**: jangan membuat duplikat; periksa status provider dan
  request ID sebelum retry.

Admin Console tidak menyediakan manajemen user, hard delete, bulk import, audit
trail, analytics, MFA, atau retrieval tester.
