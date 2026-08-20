# Autentikasi dan Otorisasi Admin

Dokumen ini menjelaskan Fase 1 dashboard admin. Fase ini hanya menyediakan login,
refresh session, pemeriksaan session, logout, dan halaman minimal `/admin`.

## Batas keamanan

- Supabase Auth client dibuat baru untuk setiap operasi autentikasi dan memakai
  `SUPABASE_PUBLISHABLE_KEY`.
- Session disimpan pada cookie HttpOnly. Access token dan refresh token tidak
  dikirim melalui JSON dan tidak dapat dibaca JavaScript dashboard.
- Supabase service-role client hanya memeriksa `public.admin_users` setelah
  Supabase Auth berhasil memverifikasi user.
- Migration mereset seluruh privilege langsung `PUBLIC`, `anon`, `authenticated`,
  dan `service_role` pada `admin_users`, lalu memberikan kembali hanya `SELECT`
  kepada runtime `service_role`. Bootstrap dan perubahan membership dilakukan
  melalui proses SQL administratif.
- `ADMIN_INGEST_KEY` tetap khusus endpoint legacy dan tidak digunakan dashboard.
- Tidak tersedia public signup atau endpoint untuk membuat, mengaktifkan, atau
  mengubah administrator.
- MFA belum termasuk Fase 1 dan wajib ditambahkan sebelum penggunaan kampus
  secara nyata.

## Konfigurasi

Variable baru:

- `SUPABASE_PUBLISHABLE_KEY`: publishable key untuk operasi Supabase Auth.
- `ADMIN_APP_ORIGIN`: origin kanonis tunggal yang boleh menjalankan mutasi admin,
  misalnya `https://admin.example.com` tanpa slash akhir, path, query, fragment,
  atau credential.
- `ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS`: umur maksimum cookie refresh dan CSRF.
- `ADMIN_LOGIN_RATE_LIMIT`: jumlah percobaan login per 15 menit per limiter key.

Seluruh secret tetap hanya berada pada backend. Dashboard tidak boleh membaca
atau mengubah konfigurasi environment. Pada deployment, `ADMIN_APP_ORIGIN` juga
harus tercantum dalam `ALLOWED_ORIGINS`.

Limiter login Fase 1 mengikuti memory store yang sudah dipakai proyek. Pada
Vercel serverless batas ini berlaku per instance dan bukan pembatas global;
durable/global rate limit merupakan pekerjaan hardening sebelum penggunaan
kampus secara nyata.

## Endpoint

| Method | Endpoint | Keterangan |
|---|---|---|
| `POST` | `/api/admin/auth/login` | Login email/password dan pemasangan cookie |
| `POST` | `/api/admin/auth/refresh` | Rotasi session menggunakan refresh cookie |
| `POST` | `/api/admin/auth/logout` | Revoke bila memungkinkan dan hapus cookie session lokal |
| `GET` | `/api/admin/auth/session` | Identitas admin dan role aktif |

Seluruh respons endpoint auth memakai `Cache-Control: no-store`. Respons sukses
hanya memuat ID, email, dan role admin. Respons error memakai envelope proyek.

## Cookie dan CSRF

Cookie access dan refresh memakai `HttpOnly`, `SameSite=Strict`, path
`/api/admin`, `Max-Age` eksplisit, serta `Secure` pada production. Cookie CSRF
terpisah, tidak mengandung credential, dan memakai path `/` agar JavaScript
dapat mengirim nilainya kembali melalui header `x-csrf-token`.

Duplicate atau percent-encoding malformed pada cookie keamanan diperlakukan
sebagai tidak valid oleh backend dan frontend. Nilai cookie selalu di-encode
sebelum ditulis ke header.

Semua mutasi memerlukan:

1. header `Origin` yang sama persis dengan `ADMIN_APP_ORIGIN`;
2. nilai cookie CSRF yang sama dengan header `x-csrf-token`.

Jika login atau refresh berhasil membuat session Supabase tetapi membership
admin kemudian ditolak, backend melakukan best-effort cleanup hanya terhadap
session tersebut dengan scope `local`. Error provider tidak disalin ke response
atau log; log aplikasi hanya menyimpan request ID, path, dan kode internal.

## Bootstrap admin manual

Langkah ini dilakukan kemudian pada environment yang disetujui, bukan oleh
aplikasi atau migration otomatis:

1. Terapkan `002_admin_auth.sql` melalui proses migration resmi.
2. Buat atau invite user secara manual melalui Supabase Auth.
3. Salin UUID user dari Supabase Auth.
4. Tambahkan membership melalui SQL terkontrol:

   ```sql
   insert into public.admin_users (user_id, role, is_active, created_by)
   values ('USER_UUID', 'admin', true, null);
   ```

5. Verifikasi login pada preview/non-production terlebih dahulu.

Untuk mencabut akses tanpa menghapus user Auth:

```sql
update public.admin_users
set is_active = false, updated_at = now()
where user_id = 'USER_UUID';
```

## Rollback operasional

Migration bersifat additive dan tidak memiliki destructive down migration.
Jika release perlu di-rollback:

1. rollback deployment aplikasi ke versi sebelum Fase 1;
2. biarkan tabel `admin_users` tetap ada karena kode lama tidak menggunakannya;
3. nonaktifkan membership jika akses perlu segera dihentikan;
4. hapus tabel hanya melalui migration terpisah setelah backup dan verifikasi
   bahwa tidak ada deployment yang masih menggunakannya.
