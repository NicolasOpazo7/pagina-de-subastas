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

create index if not exists auction_deals_seller_id_idx on public.auction_deals(seller_id);
create index if not exists auction_deals_buyer_id_idx on public.auction_deals(buyer_id);
create index if not exists deal_messages_deal_id_idx on public.deal_messages(deal_id, created_at);

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

drop trigger if exists set_auction_deals_updated_at on public.auction_deals;
create trigger set_auction_deals_updated_at
before update on public.auction_deals
for each row execute function public.set_updated_at();

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

alter table public.auction_deals enable row level security;
alter table public.deal_messages enable row level security;

revoke all on public.auction_deals from anon, authenticated;
revoke all on public.deal_messages from anon, authenticated;

grant select on public.auction_deals to authenticated;
grant select, insert on public.deal_messages to authenticated;
grant execute on function public.user_bid_on_product(uuid, uuid) to authenticated;
grant execute on function public.ensure_auction_deal(uuid) to authenticated;
grant execute on function public.mark_deal_confirmation(uuid, boolean) to authenticated;

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

drop policy if exists "Usuarios ven productos donde pujaron" on public.products;
create policy "Usuarios ven productos donde pujaron"
on public.products
for select
to authenticated
using (public.user_bid_on_product(products.id, (select auth.uid())));

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

notify pgrst, 'reload schema';
