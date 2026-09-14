-- Persempit privilege runtime agar lifecycle FAQ bersifat archive-only.

revoke all on table public.faq_documents
from public, anon, authenticated, service_role;

grant select, insert, update
on table public.faq_documents
to service_role;
