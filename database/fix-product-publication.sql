create extension if not exists pgcrypto;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  storage_path text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_images_product_id_idx
on public.product_images(product_id, display_order);

alter table public.product_images enable row level security;

grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Todos pueden ver imagenes de productos" on public.product_images;
create policy "Todos pueden ver imagenes de productos"
on public.product_images
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_images.product_id
      and products.status = 'open'
  )
);

drop policy if exists "Subastadores ven imagenes de sus productos" on public.product_images;
create policy "Subastadores ven imagenes de sus productos"
on public.product_images
for select
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_images.product_id
      and (
        products.seller_id = (select auth.uid())
        or public.is_admin((select auth.uid()))
      )
  )
);

drop policy if exists "Subastadores agregan imagenes a sus productos" on public.product_images;
create policy "Subastadores agregan imagenes a sus productos"
on public.product_images
for insert
to authenticated
with check (
  exists (
    select 1
    from public.products
    where products.id = product_images.product_id
      and products.seller_id = (select auth.uid())
  )
);

drop policy if exists "Subastadores editan imagenes de sus productos" on public.product_images;
create policy "Subastadores editan imagenes de sus productos"
on public.product_images
for update
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_images.product_id
      and products.seller_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.products
    where products.id = product_images.product_id
      and products.seller_id = (select auth.uid())
  )
);

drop policy if exists "Subastadores eliminan imagenes de sus productos" on public.product_images;
create policy "Subastadores eliminan imagenes de sus productos"
on public.product_images
for delete
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = product_images.product_id
      and products.seller_id = (select auth.uid())
  )
);

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

notify pgrst, 'reload schema';
