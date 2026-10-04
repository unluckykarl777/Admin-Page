-- Supabase Authentication > Users에 관리자로 사용할 계정을 먼저 만드세요.
-- 아래 이메일을 그 계정 이메일로 바꾼 뒤 SQL Editor에서 실행하면 관리자 권한을 부여합니다.

insert into public.admin_users (user_id, email)
select id, email
from auth.users
where lower(email) = lower('ppiyo-studio@naver.com')
on conflict (user_id) do update set email = excluded.email;
