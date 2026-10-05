grant delete on public.products to authenticated;
grant delete on public.bids to authenticated;
grant delete on public.product_images to authenticated;

drop policy if exists "Subastadores eliminan sus productos" on public.products;
create policy "Subastadores eliminan sus productos"
on public.products
for delete
to authenticated
using (
  seller_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
);

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

notify pgrst, 'reload schema';
