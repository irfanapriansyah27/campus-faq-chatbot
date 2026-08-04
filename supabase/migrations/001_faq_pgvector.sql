-- Jalankan satu kali melalui Supabase SQL Editor.
-- Gemini gemini-embedding-001 dikonfigurasi menghasilkan 1536 dimensi.

create extension if not exists vector with schema extensions;

create table if not exists public.faq_documents (
  id uuid primary key default gen_random_uuid(),
  faq_key text not null unique,
  question text not null,
  answer text not null,
  content text not null,
  category text not null default 'umum',
  source text not null default 'admin',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'published'
    check (status in ('draft', 'published', 'archived')),
  version integer not null default 1 check (version > 0),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faq_documents_category_idx
  on public.faq_documents (category);

create index if not exists faq_documents_status_idx
  on public.faq_documents (status);

create index if not exists faq_documents_embedding_hnsw_idx
  on public.faq_documents
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.faq_documents enable row level security;

create or replace function public.match_faq(
  query_embedding extensions.vector(1536),
  match_threshold double precision default 0.50,
  match_count integer default 3
)
returns table (
  id uuid,
  faq_key text,
  question text,
  answer text,
  category text,
  source text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    faq.id,
    faq.faq_key,
    faq.question,
    faq.answer,
    faq.category,
    faq.source,
    faq.metadata,
    1 - (faq.embedding <=> query_embedding) as similarity
  from public.faq_documents as faq
  where faq.status = 'published'
    and 1 - (faq.embedding <=> query_embedding) >= match_threshold
  order by faq.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 10);
$$;

revoke all on function public.match_faq(
  extensions.vector,
  double precision,
  integer
) from public, anon, authenticated;

grant execute on function public.match_faq(
  extensions.vector,
  double precision,
  integer
) to service_role;

revoke all on table public.faq_documents from anon, authenticated;
grant select, insert, update, delete on table public.faq_documents to service_role;
