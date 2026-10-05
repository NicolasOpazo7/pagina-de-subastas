insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Todos pueden ver archivos de productos" on storage.objects;
create policy "Todos pueden ver archivos de productos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "Usuarios autenticados suben imagenes de productos" on storage.objects;
create policy "Usuarios autenticados suben imagenes de productos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and owner = (select auth.uid())
);

drop policy if exists "Usuarios actualizan sus imagenes de productos" on storage.objects;
create policy "Usuarios actualizan sus imagenes de productos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and owner = (select auth.uid())
)
with check (
  bucket_id = 'product-images'
  and owner = (select auth.uid())
);

drop policy if exists "Usuarios eliminan sus imagenes de productos" on storage.objects;
create policy "Usuarios eliminan sus imagenes de productos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and owner = (select auth.uid())
);
