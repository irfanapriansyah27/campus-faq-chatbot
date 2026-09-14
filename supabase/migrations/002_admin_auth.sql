-- Additive migration untuk membership admin dashboard.
-- User Supabase Auth dibuat manual; dashboard tidak menyediakan signup/manajemen admin.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'admin'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists admin_users_active_idx
  on public.admin_users (is_active)
  where is_active = true;

alter table public.admin_users enable row level security;

revoke all on table public.admin_users from public, anon, authenticated, service_role;
grant select on table public.admin_users to service_role;

comment on table public.admin_users is
  'Allowlist administrator aplikasi; hanya diakses backend setelah Supabase Auth memverifikasi user.';
