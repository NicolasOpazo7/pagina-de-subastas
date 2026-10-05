create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'usuario', 'subastador');
  end if;

  if not exists (select 1 from pg_type where typname = 'auction_status') then
    create type public.auction_status as enum ('open', 'closed');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'usuario',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null,
  image_url text,
  starting_price numeric(12, 2) not null check (starting_price > 0),
  current_price numeric(12, 2) not null check (current_price > 0),
  ends_at timestamptz not null,
  is_featured boolean not null default false,
  status public.auction_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint current_price_not_lower_than_start check (current_price >= starting_price)
);

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  bidder_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  storage_path text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products(category);
create index if not exists products_seller_id_idx on public.products(seller_id);
create index if not exists products_featured_idx on public.products(is_featured);
create index if not exists bids_product_id_amount_idx on public.bids(product_id, amount desc);
create index if not exists bids_bidder_id_idx on public.bids(bidder_id);
create index if not exists product_images_product_id_idx on public.product_images(product_id, display_order);

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'usuario');

  if requested_role not in ('usuario', 'subastador') then
    requested_role := 'usuario';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    requested_role::public.user_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'admin'
  );
$$;

create or replace function public.place_bid(product_id uuid, bid_amount numeric)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  auction public.products;
  bidder_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para ofertar.';
  end if;

  select role into bidder_role
  from public.profiles
  where id = auth.uid();

  if bidder_role is null then
    raise exception 'Perfil de usuario no encontrado.';
  end if;

  if bidder_role = 'admin' then
    raise exception 'El administrador no puede pujar.';
  end if;

  select *
  into auction
  from public.products
  where id = product_id
  for update;

  if auction.id is null then
    raise exception 'Producto no encontrado.';
  end if;

  if auction.seller_id = auth.uid() then
    raise exception 'No puedes ofertar por tu propio producto.';
  end if;

  if auction.status <> 'open' or auction.ends_at <= now() then
    raise exception 'Esta subasta ya no esta disponible.';
  end if;

  if bid_amount <= auction.current_price then
    raise exception 'La oferta debe ser mayor que la oferta actual.';
  end if;

  insert into public.bids (product_id, bidder_id, amount)
  values (product_id, auth.uid(), bid_amount);

  update public.products
  set current_price = bid_amount
  where id = product_id
  returning * into auction;

  return auction;
end;
$$;

create or replace function public.complete_google_profile(full_name text, desired_role text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles;
  safe_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if desired_role not in ('usuario', 'subastador') then
    safe_role := 'usuario';
  else
    safe_role := desired_role::public.user_role;
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    auth.uid(),
    coalesce(nullif(trim(full_name), ''), 'Usuario Google'),
    safe_role
  )
  on conflict (id) do update
  set
    full_name = coalesce(nullif(trim(excluded.full_name), ''), public.profiles.full_name),
    role = case
      when public.profiles.role = 'usuario' then safe_role
      else public.profiles.role
    end
  returning * into current_profile;

  return current_profile;
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.bids enable row level security;
alter table public.product_images enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.bids from anon, authenticated;
revoke all on public.product_images from anon, authenticated;

grant select on public.products to anon, authenticated;
grant select on public.product_images to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert on public.bids to authenticated;
grant delete on public.bids to authenticated;
grant insert, update on public.products to authenticated;
grant delete on public.products to authenticated;
grant insert, update, delete on public.product_images to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant execute on function public.place_bid(uuid, numeric) to authenticated;
grant execute on function public.complete_google_profile(text, text) to authenticated;

drop policy if exists "Todos pueden ver productos abiertos" on public.products;
create policy "Todos pueden ver productos abiertos"
on public.products
for select
to anon, authenticated
using (status = 'open');

drop policy if exists "Subastadores ven sus productos" on public.products;
create policy "Subastadores ven sus productos"
on public.products
for select
to authenticated
using (
  seller_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
);

drop policy if exists "Subastadores pueden publicar productos" on public.products;
create policy "Subastadores pueden publicar productos"
on public.products
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('subastador', 'admin')
  )
);

drop policy if exists "Subastadores actualizan sus productos" on public.products;
create policy "Subastadores actualizan sus productos"
on public.products
for update
to authenticated
using (
  seller_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
)
with check (
  seller_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
);

drop policy if exists "Subastadores eliminan sus productos" on public.products;
create policy "Subastadores eliminan sus productos"
on public.products
for delete
to authenticated
using (
  seller_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
);

drop policy if exists "Todos pueden ver imagenes de productos" on public.product_images;
create policy "Todos pueden ver imagenes de productos"
on public.product_images
for select
to anon, authenticated
using (
  exists (
    select 1 from public.products
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
    select 1 from public.products
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
    select 1 from public.products
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
    select 1 from public.products
    where products.id = product_images.product_id
      and products.seller_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.products
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
    select 1 from public.products
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

drop policy if exists "Subastadores suben archivos de productos" on storage.objects;
create policy "Subastadores suben archivos de productos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Subastadores actualizan sus archivos de productos" on storage.objects;
create policy "Subastadores actualizan sus archivos de productos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Subastadores eliminan sus archivos de productos" on storage.objects;
create policy "Subastadores eliminan sus archivos de productos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Usuarios ven su perfil" on public.profiles;
create policy "Usuarios ven su perfil"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or public.is_admin((select auth.uid())));

drop policy if exists "Usuarios actualizan su perfil" on public.profiles;
create policy "Usuarios actualizan su perfil"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "Usuarios ven sus pujas" on public.bids;
create policy "Usuarios ven sus pujas"
on public.bids
for select
to authenticated
using (
  bidder_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
  or exists (
    select 1 from public.products
    where products.id = bids.product_id
      and products.seller_id = (select auth.uid())
  )
);

drop policy if exists "Usuarios crean sus pujas" on public.bids;
create policy "Usuarios crean sus pujas"
on public.bids
for insert
to authenticated
with check (bidder_id = (select auth.uid()));

drop policy if exists "Subastadores eliminan pujas de sus productos" on public.bids;
create policy "Subastadores eliminan pujas de sus productos"
on public.bids
for delete
to authenticated
using (
  exists (
    select 1
    from public.products
    where products.id = bids.product_id
      and (
        products.seller_id = (select auth.uid())
        or public.is_admin((select auth.uid()))
      )
  )
);

insert into public.products (
  seller_id,
  title,
  description,
  category,
  image_url,
  starting_price,
  current_price,
  ends_at,
  is_featured
)
select
  p.id,
  item.title,
  item.description,
  item.category,
  item.image_url,
  item.starting_price,
  item.current_price,
  item.ends_at,
  item.is_featured
from public.profiles p
cross join (
  values
    ('Reloj Automatico Heritage', 'Movimiento visible, correa de cuero italiano y caja de acero pulido.', 'relojeria', 'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=900&q=80', 350000::numeric, 425000::numeric, now() + interval '2 hours', true),
    ('Collar Aurea con Zafiro', 'Pieza fina en oro laminado, ideal para coleccionistas y regalos especiales.', 'joyeria', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80', 240000::numeric, 310000::numeric, now() + interval '5 hours', true),
    ('Notebook Pro 15', 'Equipo de alto rendimiento con pantalla retina, SSD de 1 TB y garantia activa.', 'tecnologia', 'https://images.unsplash.com/photo-1510915228340-29c85a43dcfe?auto=format&fit=crop&w=900&q=80', 750000::numeric, 890000::numeric, now() + interval '11 hours', true)
) as item(title, description, category, image_url, starting_price, current_price, ends_at, is_featured)
where p.role in ('subastador', 'admin')
  and not exists (select 1 from public.products)
limit 3;

-- Para crear el admin:
-- 1. Crea un usuario en Supabase Auth con email admin@aurumsubastas.cl y password admin123.
-- 2. Luego ejecuta:
-- update public.profiles set role = 'admin', full_name = 'Administrador' where id = 'UUID_DEL_USUARIO_ADMIN';
