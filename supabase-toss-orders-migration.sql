-- 기존 관리자 주문 스키마를 유지하면서 토스 결제 정보를 저장합니다.
-- Supabase SQL Editor에서 프로젝트 qecylsttsiaizunbzqdx에 1회 실행하세요.

create table if not exists public.kv_store_41917659 (
  key text primary key,
  value jsonb not null
);

alter table public.orders
  add column if not exists order_name text not null default '',
  add column if not exists toss_payment_key text,
  add column if not exists method text not null default '',
  add column if not exists approved_at timestamptz,
  add column if not exists customer_phone text not null default '',
  add column if not exists shipping_address text not null default '',
  add column if not exists shipping_address_detail text not null default '',
  add column if not exists shipping_memo text not null default '';

alter table public.order_items
  add column if not exists selected_size text;

create unique index if not exists orders_toss_payment_key_uidx
  on public.orders (toss_payment_key)
  where toss_payment_key is not null;

create index if not exists kv_store_41917659_key_idx
  on public.kv_store_41917659 (key);

alter table public.kv_store_41917659 enable row level security;
revoke all on public.kv_store_41917659 from anon, authenticated;

create or replace function public.save_paid_order(
  p_order_id text,
  p_order_name text,
  p_amount integer,
  p_payment_key text,
  p_payment_status text,
  p_method text,
  p_approved_at timestamptz,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address text,
  p_shipping_address_detail text,
  p_shipping_memo text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_order_id uuid;
begin
  if p_payment_status <> 'DONE' then
    raise exception 'Only verified DONE payments can be stored';
  end if;
  if p_amount <= 0 or p_order_id is null or p_payment_key is null then
    raise exception 'Verified order identifiers and amount are required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order items are required';
  end if;

  insert into public.orders (
    order_number, order_name, total_amount, toss_payment_key,
    payment_status, fulfillment_status, method, approved_at,
    customer_name, customer_email, customer_phone,
    shipping_address, shipping_address_detail, shipping_memo
  ) values (
    p_order_id, p_order_name, p_amount, p_payment_key,
    'paid', 'new', coalesce(p_method, ''), p_approved_at,
    p_customer_name, coalesce(p_customer_email, ''), coalesce(p_customer_phone, ''),
    coalesce(p_shipping_address, ''), coalesce(p_shipping_address_detail, ''),
    coalesce(p_shipping_memo, '')
  )
  on conflict (order_number) do nothing
  returning id into saved_order_id;

  if saved_order_id is null then
    select id into saved_order_id
      from public.orders
      where order_number = p_order_id
        and toss_payment_key = p_payment_key
        and total_amount = p_amount
        and payment_status = 'paid';
    if saved_order_id is null then
      raise exception 'Existing order does not match the verified payment';
    end if;
    return;
  end if;

  insert into public.order_items (
    order_id, product_id, product_name, quantity, unit_price, selected_size
  )
  select
    saved_order_id,
    coalesce(
      (select p.id from public.products p where p.id::text = item->>'id' limit 1),
      (select p.id from public.products p where p.sku = item->>'id' limit 1)
    ),
    item->>'name',
    (item->>'quantity')::integer,
    (item->>'price')::integer,
    nullif(item->>'selectedSize', '')
  from jsonb_array_elements(p_items) as item;
end;
$$;

revoke all on function public.save_paid_order(
  text, text, integer, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.save_paid_order(
  text, text, integer, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) to service_role;
