-- Aurum Subastas - esquema inicial consolidado
-- Ejecuta este archivo completo en Supabase SQL Editor para preparar una base limpia.

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

create table if not exists public.auction_deals (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  winning_bid_id uuid not null references public.bids(id) on delete cascade,
  final_price numeric(12, 2) not null check (final_price > 0),
  seller_confirmed boolean not null default false,
  buyer_confirmed boolean not null default false,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auction_deals_product_unique unique (product_id),
  constraint auction_deals_distinct_users check (seller_id <> buyer_id)
);

create table if not exists public.deal_messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.auction_deals(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products(category);
create index if not exists products_seller_id_idx on public.products(seller_id);
create index if not exists products_featured_idx on public.products(is_featured);
create index if not exists products_status_ends_at_idx on public.products(status, ends_at);
create index if not exists bids_product_id_amount_idx on public.bids(product_id, amount desc);
create index if not exists bids_bidder_id_idx on public.bids(bidder_id);
create index if not exists product_images_product_id_idx on public.product_images(product_id, display_order);
create index if not exists auction_deals_seller_id_idx on public.auction_deals(seller_id);
create index if not exists auction_deals_buyer_id_idx on public.auction_deals(buyer_id);
create index if not exists deal_messages_deal_id_idx on public.deal_messages(deal_id, created_at);

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

drop trigger if exists set_auction_deals_updated_at on public.auction_deals;
create trigger set_auction_deals_updated_at
before update on public.auction_deals
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

create or replace function public.user_bid_on_product(target_product_id uuid, user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.bids
    where product_id = target_product_id
      and bidder_id = user_id
  );
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

create or replace function public.ensure_auction_deal(target_product_id uuid)
returns public.auction_deals
language plpgsql
security definer
set search_path = public
as $$
declare
  auction public.products;
  winning_bid public.bids;
  deal public.auction_deals;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  select *
  into auction
  from public.products
  where id = target_product_id
  for update;

  if auction.id is null then
    raise exception 'Producto no encontrado.';
  end if;

  if auction.status = 'open' and auction.ends_at > now() then
    raise exception 'La subasta aun no ha finalizado.';
  end if;

  select *
  into winning_bid
  from public.bids
  where product_id = auction.id
  order by amount desc, created_at asc
  limit 1;

  if winning_bid.id is null then
    raise exception 'Esta subasta no tiene ofertas.';
  end if;

  if auth.uid() <> auction.seller_id
    and auth.uid() <> winning_bid.bidder_id
    and not public.is_admin(auth.uid()) then
    raise exception 'No tienes permiso para abrir este acuerdo.';
  end if;

  update public.products
  set status = 'closed'
  where id = auction.id
    and status <> 'closed';

  insert into public.auction_deals (
    product_id,
    seller_id,
    buyer_id,
    winning_bid_id,
    final_price
  )
  values (
    auction.id,
    auction.seller_id,
    winning_bid.bidder_id,
    winning_bid.id,
    winning_bid.amount
  )
  on conflict (product_id) do update
  set
    seller_id = excluded.seller_id,
    buyer_id = excluded.buyer_id,
    winning_bid_id = excluded.winning_bid_id,
    final_price = excluded.final_price,
    updated_at = now()
  returning * into deal;

  return deal;
end;
$$;

create or replace function public.mark_deal_confirmation(target_deal_id uuid, confirmed boolean)
returns public.auction_deals
language plpgsql
security definer
set search_path = public
as $$
declare
  deal public.auction_deals;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  select *
  into deal
  from public.auction_deals
  where id = target_deal_id
  for update;

  if deal.id is null then
    raise exception 'Acuerdo no encontrado.';
  end if;

  if auth.uid() <> deal.seller_id and auth.uid() <> deal.buyer_id then
    raise exception 'No tienes permiso para confirmar este acuerdo.';
  end if;

  update public.auction_deals
  set
    seller_confirmed = case when auth.uid() = seller_id then confirmed else seller_confirmed end,
    buyer_confirmed = case when auth.uid() = buyer_id then confirmed else buyer_confirmed end
  where id = target_deal_id
  returning * into deal;

  if deal.seller_confirmed and deal.buyer_confirmed then
    update public.auction_deals
    set status = 'completed'
    where id = target_deal_id
    returning * into deal;
  end if;

  return deal;
end;
$$;

create or replace function public.close_expired_auctions()
returns table(closed_count integer, deals_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  auction public.products;
  winning_bid public.bids;
  closed_total integer := 0;
  deals_total integer := 0;
begin
  for auction in
    select *
    from public.products
    where status = 'open'
      and ends_at <= now()
    for update
  loop
    update public.products
    set status = 'closed'
    where id = auction.id;

    closed_total := closed_total + 1;

    select *
    into winning_bid
    from public.bids
    where product_id = auction.id
    order by amount desc, created_at asc
    limit 1;

    if winning_bid.id is not null then
      insert into public.auction_deals (
        product_id,
        seller_id,
        buyer_id,
        winning_bid_id,
        final_price
      )
      values (
        auction.id,
        auction.seller_id,
        winning_bid.bidder_id,
        winning_bid.id,
        winning_bid.amount
      )
      on conflict (product_id) do update
      set
        seller_id = excluded.seller_id,
        buyer_id = excluded.buyer_id,
        winning_bid_id = excluded.winning_bid_id,
        final_price = excluded.final_price,
        updated_at = now();

      deals_total := deals_total + 1;
    end if;
  end loop;

  closed_count := closed_total;
  deals_count := deals_total;
  return next;
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.bids enable row level security;
alter table public.product_images enable row level security;
alter table public.auction_deals enable row level security;
alter table public.deal_messages enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.bids from anon, authenticated;
revoke all on public.product_images from anon, authenticated;
revoke all on public.auction_deals from anon, authenticated;
revoke all on public.deal_messages from anon, authenticated;

grant select on public.products to anon, authenticated;
grant select on public.product_images to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert on public.bids to authenticated;
grant delete on public.bids to authenticated;
grant insert, update, delete on public.products to authenticated;
grant insert, update, delete on public.product_images to authenticated;
grant select on public.auction_deals to authenticated;
grant select, insert on public.deal_messages to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant execute on function public.complete_google_profile(text, text) to authenticated;
grant execute on function public.place_bid(uuid, numeric) to authenticated;
grant execute on function public.user_bid_on_product(uuid, uuid) to authenticated;
grant execute on function public.ensure_auction_deal(uuid) to authenticated;
grant execute on function public.mark_deal_confirmation(uuid, boolean) to authenticated;
grant execute on function public.close_expired_auctions() to anon, authenticated;

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

drop policy if exists "Usuarios ven productos donde pujaron" on public.products;
create policy "Usuarios ven productos donde pujaron"
on public.products
for select
to authenticated
using (public.user_bid_on_product(products.id, (select auth.uid())));

drop policy if exists "Participantes ven productos acordados" on public.products;
create policy "Participantes ven productos acordados"
on public.products
for select
to authenticated
using (
  exists (
    select 1
    from public.auction_deals
    where auction_deals.product_id = products.id
      and (
        auction_deals.seller_id = (select auth.uid())
        or auction_deals.buyer_id = (select auth.uid())
        or public.is_admin((select auth.uid()))
      )
  )
);

drop policy if exists "Subastadores pueden publicar productos" on public.products;
create policy "Subastadores pueden publicar productos"
on public.products
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles
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

drop policy if exists "Participantes ven imagenes de productos acordados" on public.product_images;
create policy "Participantes ven imagenes de productos acordados"
on public.product_images
for select
to authenticated
using (
  exists (
    select 1
    from public.auction_deals
    where auction_deals.product_id = product_images.product_id
      and (
        auction_deals.seller_id = (select auth.uid())
        or auction_deals.buyer_id = (select auth.uid())
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

drop policy if exists "Usuarios ven su perfil" on public.profiles;
create policy "Usuarios ven su perfil"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.is_admin((select auth.uid()))
);

drop policy if exists "Participantes ven perfiles del acuerdo" on public.profiles;
create policy "Participantes ven perfiles del acuerdo"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.is_admin((select auth.uid()))
  or exists (
    select 1
    from public.auction_deals
    where (
      auction_deals.seller_id = (select auth.uid())
      or auction_deals.buyer_id = (select auth.uid())
    )
    and profiles.id in (auction_deals.seller_id, auction_deals.buyer_id)
  )
);

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
    select 1
    from public.products
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

drop policy if exists "Participantes ven sus acuerdos" on public.auction_deals;
create policy "Participantes ven sus acuerdos"
on public.auction_deals
for select
to authenticated
using (
  seller_id = (select auth.uid())
  or buyer_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
);

drop policy if exists "Participantes ven mensajes del acuerdo" on public.deal_messages;
create policy "Participantes ven mensajes del acuerdo"
on public.deal_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.auction_deals
    where auction_deals.id = deal_messages.deal_id
      and (
        auction_deals.seller_id = (select auth.uid())
        or auction_deals.buyer_id = (select auth.uid())
        or public.is_admin((select auth.uid()))
      )
  )
);

drop policy if exists "Participantes envian mensajes del acuerdo" on public.deal_messages;
create policy "Participantes envian mensajes del acuerdo"
on public.deal_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.auction_deals
    where auction_deals.id = deal_messages.deal_id
      and (
        auction_deals.seller_id = (select auth.uid())
        or auction_deals.buyer_id = (select auth.uid())
      )
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

notify pgrst, 'reload schema';

-- Para crear el admin:
-- 1. Crea un usuario en Supabase Auth con email admin@aurumsubastas.cl y password admin123.
-- 2. Luego ejecuta:
-- update public.profiles set role = 'admin', full_name = 'Administrador' where id = 'UUID_DEL_USUARIO_ADMIN';
