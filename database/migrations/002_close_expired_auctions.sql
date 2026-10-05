-- Cierra subastas vencidas y prepara acuerdos con el ganador.
-- Ejecuta este archivo despues de 001_initial_schema.sql si tu base ya existe.

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

grant execute on function public.close_expired_auctions() to anon, authenticated;

notify pgrst, 'reload schema';
