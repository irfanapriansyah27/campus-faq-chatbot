# Autentikasi dan Otorisasi Admin

Dokumen ini merinci keamanan autentikasi Admin Console. Panduan penggunaan ada
di [ADMIN_GUIDE.md](ADMIN_GUIDE.md) dan prosedur operasional ada di
[OPERATIONS.md](OPERATIONS.md).

## Batas keamanan

- Supabase Auth client dibuat baru untuk setiap operasi dan memakai publishable
  key; service-role client hanya berjalan di backend.
- Access dan refresh token disimpan pada cookie HttpOnly dan tidak dikembalikan
  melalui JSON.
- Setelah Supabase Auth memverifikasi user, backend mencari UUID pada
  `public.admin_users`. Login hanya berhasil untuk `role=admin` dan
  `is_active=true`.
- Runtime hanya memiliki `SELECT` pada `admin_users`; bootstrap/perubahan
  membership dilakukan melalui prosedur database administratif terkontrol.
- Tidak ada public signup atau endpoint aplikasi untuk mengelola administrator.
- `ADMIN_INGEST_KEY` hanya melindungi endpoint legacy dan bukan credential login.

## Environment

- `SUPABASE_PUBLISHABLE_KEY`: operasi Supabase Auth;
- `ADMIN_APP_ORIGIN`: satu origin kanonis tanpa slash akhir, path, query,
  fragment, atau credential;
- `ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS`: umur maksimum refresh/CSRF cookie;
- `ADMIN_LOGIN_RATE_LIMIT`: batas percobaan login per 15 menit per instance.

`ADMIN_APP_ORIGIN` juga harus ada dalam `ALLOWED_ORIGINS`. Limiter menggunakan
memory store per instance Vercel; durable/global rate limiting belum tersedia.

## Cookie dan CSRF

Cookie access dan refresh memakai `HttpOnly`, `SameSite=Strict`, path
`/api/admin`, `Max-Age` eksplisit, dan `Secure` pada Production. Cookie CSRF
terpisah memakai path `/` agar JavaScript dapat mengirim nilainya melalui header
`x-csrf-token`.

Login, refresh, logout, serta mutasi FAQ memerlukan:

1. header `Origin` yang sama persis dengan `ADMIN_APP_ORIGIN`;
2. cookie CSRF yang sama dengan header `x-csrf-token`.

Duplicate atau percent-encoding malformed pada cookie keamanan dianggap invalid.
Jika Auth berhasil tetapi allowlist menolak user, backend membersihkan session
lokal secara best effort.

## Bootstrap dan pencabutan akses

Admin pertama dibuat melalui proses operasional: buat user di Supabase Auth,
ambil UUID akun yang dipilih, lalu tambahkan satu membership yang aktif. Jangan
menyimpan email, password, token, atau UUID nyata dalam repository.

Pencabutan akses sebaiknya menonaktifkan membership sambil mempertahankan jejak
operasional:

```sql
update public.admin_users
set is_active = false, updated_at = now()
where user_id = '<user-uuid>';
```

Setiap perubahan membership adalah write Production dan memerlukan target check,
otorisasi eksplisit, serta verifikasi session setelahnya.
