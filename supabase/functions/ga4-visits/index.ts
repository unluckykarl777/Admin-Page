// Secure GA4 read endpoint for the PPiyo admin dashboard.
// Required Supabase secrets: GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_JSON
// The service account JSON is never sent to the browser.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const pem = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned),
  ));
  const assertion = `${unsigned}.${base64url(signature)}`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error("Google 인증 실패");
  return result.access_token as string;
}

async function runReport(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error("GA4 보고서 조회 실패");
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: true, message: "허용되지 않은 요청입니다." }, 405);

  try {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: true, message: "관리자 로그인 후 이용해 주세요." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const apiKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !apiKey) throw new Error("Supabase 설정이 없습니다.");

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: authHeader },
    });
    if (!userResponse.ok) return json({ error: true, message: "로그인 상태를 확인해 주세요." }, 401);
    const user = await userResponse.json();

    const adminResponse = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers: { apikey: apiKey, Authorization: authHeader } },
    );
    const admins = adminResponse.ok ? await adminResponse.json() : [];
    if (!admins.length) return json({ error: true, message: "관리자 권한이 확인되지 않았어요." }, 403);

    const propertyId = Deno.env.get("GA4_PROPERTY_ID") || "";
    const serviceAccountText = Deno.env.get("GA4_SERVICE_ACCOUNT_JSON") || "";
    if (!/^\d+$/.test(propertyId) || !serviceAccountText) {
      return json({ error: true, message: "GA4 속성 ID와 읽기 계정 설정이 필요해요." }, 503);
    }
    const serviceAccount = JSON.parse(serviceAccountText);
    const accessToken = await googleAccessToken(serviceAccount);
    const baseReport = {
      dateRanges: [{ startDate: "today", endDate: "today" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
    };
    const eventReport = (eventName: string) => runReport(accessToken, propertyId, {
      dateRanges: [{ startDate: "today", endDate: "today" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: eventName } },
      },
    });
    const [overall, goods, cartEvents, purchaseEvents] = await Promise.all([
      runReport(accessToken, propertyId, baseReport),
      runReport(accessToken, propertyId, {
        ...baseReport,
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "EXACT", value: "/goods/", caseSensitive: true },
          },
        },
      }),
      eventReport("add_to_cart"),
      eventReport("purchase"),
    ]);
    const overallValues = overall.rows?.[0]?.metricValues || [];
    const goodsValues = goods.rows?.[0]?.metricValues || [];
    return json({
      activeUsers: Number(overallValues[0]?.value || 0),
      pageViews: Number(overallValues[1]?.value || 0),
      goodsPageViews: Number(goodsValues[1]?.value || 0),
      addToCart: Number(cartEvents.rows?.[0]?.metricValues?.[0]?.value || 0),
      purchases: Number(purchaseEvents.rows?.[0]?.metricValues?.[0]?.value || 0),
      date: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error("ga4-visits error", error);
    return json({ error: true, message: "GA4 조회에 실패했어요. 연결 설정을 확인해 주세요." }, 502);
  }
});
