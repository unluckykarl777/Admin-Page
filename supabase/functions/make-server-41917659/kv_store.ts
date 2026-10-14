import { createClient } from "jsr:@supabase/supabase-js@2.49.8"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const TABLE_NAME = "kv_store_41917659"

export async function get(key: string) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("value")
    .eq("key", key)
    .maybeSingle()
  if (error) throw new Error(`대기 주문 조회 실패: ${error.message}`)
  return data?.value
}

export async function set(key: string, value: unknown) {
  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert({ key, value }, { onConflict: "key" })
  if (error) throw new Error(`대기 주문 저장 실패: ${error.message}`)
}

export async function del(key: string) {
  const { error } = await supabase.from(TABLE_NAME).delete().eq("key", key)
  if (error) throw new Error(`대기 주문 삭제 실패: ${error.message}`)
}
