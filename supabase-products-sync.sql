-- 현재 Supabase products 표(id, name, description, price, image_url, stock, is_sold_out)에 맞춘 설정입니다.
-- Supabase Dashboard > SQL Editor에서 실행하세요.

alter table public.products
  add column if not exists sku text,
  add column if not exists stock_confirmed boolean not null default false;

alter table public.products
  alter column stock drop not null,
  alter column stock drop default;

create unique index if not exists products_sku_unique_idx
  on public.products (sku);

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

drop policy if exists "public can read active products" on public.products;
create policy "public can read active products" on public.products
  for select to anon, authenticated using (not is_sold_out);

insert into public.products (id, sku, name, description, price, image_url, stock, stock_confirmed, is_sold_out)
values
  (gen_random_uuid(), '001', '반려동물 포스터', '', 21900, '', null, false, false),
  (gen_random_uuid(), '002', '반려동물 카드 스티커', '', 9900, '', null, false, false),
  (gen_random_uuid(), '003', '반려동물 티셔츠', '', 23000, '', null, false, false),
  (gen_random_uuid(), '004', '반려동물 스마트톡', '', 13000, '', null, false, false),
  (gen_random_uuid(), '005', '반려동물 가방', '', 18000, '', null, false, false),
  (gen_random_uuid(), '006', '반려동물 머그컵', '', 15000, '', null, false, false)
on conflict (sku) do update set
  name = excluded.name,
  price = excluded.price,
  updated_at = now();
