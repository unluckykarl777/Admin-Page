# 삐요스튜디오 관리자

정적 관리자 페이지입니다. Vercel은 이 폴더의 `index.html`을 배포하고, Supabase는 로그인·상품 데이터·서버 기능을 담당합니다.

## GitHub와 Vercel 연결

1. GitHub에 새 저장소를 만들고 이 폴더의 파일을 올립니다.
2. Vercel에서 **Add New → Project**를 누르고 해당 GitHub 저장소를 가져옵니다.
3. Framework Preset은 **Other**, Build Command와 Output Directory는 비워 둔 채 Deploy합니다.
4. 배포가 끝나면 Vercel이 관리자 페이지 주소를 제공합니다.

이 페이지는 `supabase-config.js`의 브라우저용 publishable key를 사용합니다. 이 키는 브라우저 공개용이며, 데이터 보호는 Supabase RLS 정책으로 해야 합니다. 비밀번호나 service role key, Google 서비스 계정 JSON은 GitHub에 올리지 마세요.

## Figma 쇼핑몰과 데이터 연결

Vercel은 관리자 페이지만 올립니다. Figma로 만든 쇼핑몰과 관리자 페이지가 같은 상품을 보려면 양쪽 코드가 같은 Supabase 프로젝트의 `products` 테이블을 읽고 수정해야 합니다. Figma 사이트는 별도로 다시 게시해야 하며, Figma 사이트 주소만 이 프로젝트에 연결한다고 상품 데이터가 자동으로 공유되지는 않습니다.

## GA4 방문자 보고서

`supabase/functions/ga4-visits/index.ts`는 GA4 보고서를 읽는 Supabase Edge Function입니다. 이 함수는 Vercel에 배포되지 않습니다. Supabase에 함수를 배포하고 `GA4_SERVICE_ACCOUNT_JSON` 비밀 설정을 해야 합니다. GA4 속성 ID `557079294`는 함수 코드에 기본값으로 들어 있습니다. Google 서비스 계정 JSON은 Git 저장소에 넣지 마세요.

## 쿠폰·적립금·SEO 관리자 기능

`supabase-commerce-admin.sql`을 Supabase SQL Editor에서 실행하면 관리자 전용 회원등급 기준표와 SEO 설정 저장 표가 추가됩니다. 기존 `coupons`, `loyalty_settings` 표를 사용합니다. 이 관리자 화면에서 쿠폰·적립금·회원등급 기준을 저장할 수 있지만, 실제 쇼핑몰 결제에 혜택을 적용하려면 별도로 Figma 쇼핑몰 코드를 연결해야 합니다.
