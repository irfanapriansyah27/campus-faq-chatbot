create or replace function public.enforce_faq_documents_version_invariant()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.version := old.version + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists faq_documents_version_invariant on public.faq_documents;

create trigger faq_documents_version_invariant
before update on public.faq_documents
for each row
execute function public.enforce_faq_documents_version_invariant();
