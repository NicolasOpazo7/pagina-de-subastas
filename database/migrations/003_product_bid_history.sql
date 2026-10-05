-- Historial anonimo de pujas para la pagina de detalle del producto.

create or replace function public.get_product_bid_history(target_product_id uuid)
returns table(amount numeric, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.amount, b.created_at
  from public.bids b
  join public.products p on p.id = b.product_id
  where b.product_id = target_product_id
    and (
      p.status = 'open'
      or p.seller_id = auth.uid()
      or b.bidder_id = auth.uid()
      or public.is_admin(auth.uid())
      or exists (
        select 1
        from public.auction_deals ad
        where ad.product_id = p.id
          and (
            ad.seller_id = auth.uid()
            or ad.buyer_id = auth.uid()
          )
      )
    )
  order by b.amount desc, b.created_at asc;
$$;

grant execute on function public.get_product_bid_history(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
