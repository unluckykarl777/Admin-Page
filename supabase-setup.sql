-- 삐요스튜디오 관리자 데이터베이스 초기 설정
-- Supabase Dashboard > SQL Editor에서 실행하세요.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_ppiyo_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_ppiyo_admin() from public;
grant execute on function public.is_ppiyo_admin() to authenticated;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  description text not null default '',
  price integer not null default 0 check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  status text not null default 'active' check (status in ('active','sold_out','hidden')),
  site_url text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  customer_email text not null default '',
  total_amount integer not null default 0 check (total_amount >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','cancelled','refunded')),
  fulfillment_status text not null default 'new' check (fulfillment_status in ('new','preparing','shipped','delivered','exchange_requested','refund_requested','refunded')),
  tracking_carrier text not null default '',
  tracking_number text not null default '',
  site_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price integer not null default 0 check (unit_price >= 0)
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_type text not null check (discount_type in ('fixed','percent')),
  discount_value integer not null check (discount_value > 0),
  usage_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_settings (
  id integer primary key default 1 check (id = 1),
  is_active boolean not null default false,
  earn_rate numeric(5,2) not null default 0 check (earn_rate >= 0),
  minimum_use integer not null default 0 check (minimum_use >= 0),
  updated_at timestamptz not null default now()
);

insert into public.loyalty_settings (id) values (1) on conflict (id) do nothing;

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.coupons enable row level security;
alter table public.loyalty_settings enable row level security;

drop policy if exists "admin users can read own admin record" on public.admin_users;
create policy "admin users can read own admin record" on public.admin_users
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage orders" on public.orders;
create policy "admins manage orders" on public.orders
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage order items" on public.order_items;
create policy "admins manage order items" on public.order_items
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage loyalty settings" on public.loyalty_settings;
create policy "admins manage loyalty settings" on public.loyalty_settings
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

-- 1) Supabase Dashboard > Authentication > Users에서 관리자 이메일을 추가하세요.
-- 2) 아래 한 번 실행할 때 이메일을 실제 삐요스튜디오 관리자 이메일로 바꾸세요.
-- insert into public.admin_users (user_id, email)
-- select id, email from auth.users where email = '관리자이메일@example.com'
-- on conflict (user_id) do nothing;
