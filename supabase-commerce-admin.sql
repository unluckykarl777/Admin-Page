-- 관리자용 쿠폰, 적립금, 회원 등급 기준, SEO 설정 저장소
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

-- 기존 coupons 테이블에도 관리자 화면에서 쓰는 컬럼을 보장합니다.
alter table public.coupons
  add column if not exists name text not null default '',
  add column if not exists discount_type text not null default 'fixed',
  add column if not exists discount_value integer not null default 1
    check (discount_value > 0),
  add column if not exists usage_limit integer,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

notify pgrst, 'reload schema';

create table if not exists public.member_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  minimum_spend integer not null default 0 check (minimum_spend >= 0),
  benefits text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_seo_settings (
  id integer primary key default 1 check (id = 1),
  site_title text not null default '삐요스튜디오',
  site_description text not null default '',
  og_image_url text not null default '',
  ga4_measurement_id text not null default 'G-TXF3NNG9F3',
  google_verification text not null default '',
  naver_verification text not null default '',
  google_registered boolean not null default false,
  naver_registered boolean not null default false,
  sitemap_submitted boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.site_seo_settings (id) values (1) on conflict (id) do nothing;

alter table public.coupons enable row level security;
alter table public.loyalty_settings enable row level security;
alter table public.member_tiers enable row level security;
alter table public.site_seo_settings enable row level security;

grant select, insert, update, delete on public.coupons to authenticated;
grant select, insert, update, delete on public.loyalty_settings to authenticated;
grant select, insert, update, delete on public.member_tiers to authenticated;
grant select, insert, update, delete on public.site_seo_settings to authenticated;

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage loyalty settings" on public.loyalty_settings;
create policy "admins manage loyalty settings" on public.loyalty_settings
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage member tiers" on public.member_tiers;
create policy "admins manage member tiers" on public.member_tiers
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());

drop policy if exists "admins manage site SEO settings" on public.site_seo_settings;
create policy "admins manage site SEO settings" on public.site_seo_settings
  for all to authenticated using (public.is_ppiyo_admin()) with check (public.is_ppiyo_admin());
