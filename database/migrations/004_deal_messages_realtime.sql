-- Activa Supabase Realtime para mensajes de acuerdos.
-- Ejecuta este archivo despues de 001_initial_schema.sql si quieres chat en vivo.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deal_messages'
  ) then
    alter publication supabase_realtime add table public.deal_messages;
  end if;
end
$$;

notify pgrst, 'reload schema';
