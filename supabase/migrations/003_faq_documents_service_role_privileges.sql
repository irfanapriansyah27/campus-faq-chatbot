-- Reset managed/default ACL sebelum menetapkan privilege runtime FAQ secara deterministik.

revoke all on table public.faq_documents
from public, anon, authenticated, service_role;

grant select, insert, update, delete
on table public.faq_documents
to service_role;
