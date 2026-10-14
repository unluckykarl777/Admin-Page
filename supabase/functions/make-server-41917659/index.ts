import { createClient } from "jsr:@supabase/supabase-js@2.49.8"
import { Hono } from "npm:hono"
import { cors } from "npm:hono/cors"
import { logger } from "npm:hono/logger"
import * as kv from "./kv_store.ts"

const SERVER_PREFIX = "/make-server-41917659"
const SHIPPING_FEE = 3000
const CHECKOUT_TTL_MS = 30 * 60 * 1000
const TOSS_API_URL = "https://api.tosspayments.com/v1/payments"

type OrderItem = {
  id: string
  name: string
  price: number
  quantity: number
  selectedSize?: string
}

type PendingOrder = {
  orderId: string
  orderName: string
  amount: number
  customer: {
    name: string
    email?: string
    phone: string
  }
  shipping: {
    address: string
    addressDetail?: string
    memo?: string
  }
  items: OrderItem[]
  createdAt: string
}

type TossPayment = {
  paymentKey?: string
  orderId?: string
  totalAmount?: number
  status?: string
  method?: string
  approvedAt?: string
}

type ErrorStatus = 400 | 401 | 404 | 409 | 410 | 500 | 502

class HttpError extends Error {
  status: ErrorStatus

  constructor(status: ErrorStatus, message: string) {
    super(message)
    this.status = status
  }
}

const app = new Hono()

app.use("*", logger(console.log))
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
)

const requireEnv = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`)
  return value
}

const database = () =>
  createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

const pendingKey = (orderId: string) => `payment:pending:${orderId}`

const normalizeText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : ""

const readJson = async (c: { req: { json: () => Promise<unknown> } }) => {
  try {
    return await c.req.json()
  } catch {
    throw new HttpError(400, "요청 형식이 올바르지 않습니다.")
  }
}

const tossAuthorization = () => {
  const secretKey = requireEnv("TOSS_SECRET_KEY")
  return `Basic ${btoa(`${secretKey}:`)}`
}

const parseTossResponse = async (response: Response) => {
  const body = await response.json().catch(() => null)
  return body as TossPayment & {
    code?: string
    message?: string
  } | null
}

const fetchApprovedPayment = async (paymentKey: string) => {
  const response = await fetch(
    `${TOSS_API_URL}/${encodeURIComponent(paymentKey)}`,
    {
      headers: { Authorization: tossAuthorization() },
    },
  )
  const payment = await parseTossResponse(response)
  if (!response.ok || !payment) {
    throw new HttpError(
      502,
      payment?.message ?? "승인된 결제 정보를 확인하지 못했습니다.",
    )
  }
  return payment
}

const confirmTossPayment = async (
  paymentKey: string,
  orderId: string,
  amount: number,
) => {
  const response = await fetch(`${TOSS_API_URL}/confirm`, {
    method: "POST",
    headers: {
      Authorization: tossAuthorization(),
      "Content-Type": "application/json",
      "Idempotency-Key": orderId,
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  })
  const payment = await parseTossResponse(response)

  if (response.ok && payment) return payment

  // Toss 승인은 성공했지만 DB 저장만 실패한 경우, 재시도에서 승인 정보를
  // 다시 조회해 검증하고 저장할 수 있게 합니다.
  if (payment?.code === "ALREADY_PROCESSED_PAYMENT") {
    return await fetchApprovedPayment(paymentKey)
  }

  throw new HttpError(
    response.status >= 500 ? 502 : 400,
    payment?.message ?? "토스 결제 승인에 실패했습니다.",
  )
}

const assertVerifiedPayment = (
  payment: TossPayment,
  expected: {
    paymentKey: string
    orderId: string
    amount: number
  },
) => {
  if (
    payment.paymentKey !== expected.paymentKey ||
    payment.orderId !== expected.orderId ||
    payment.totalAmount !== expected.amount ||
    payment.status !== "DONE"
  ) {
    throw new HttpError(
      400,
      "토스 결제 승인 정보가 주문 정보와 일치하지 않습니다.",
    )
  }
}

const findSavedOrder = async (orderId: string) => {
  const { data, error } = await database()
    .from("orders")
    .select(
      "id, order_number, order_name, total_amount, toss_payment_key, payment_status, method, approved_at",
    )
    .eq("order_number", orderId)
    .maybeSingle()

  if (error) throw new Error(`주문 조회 실패: ${error.message}`)
  return data
}

app.get(`${SERVER_PREFIX}/health`, (c) => {
  return c.json({ status: "ok" })
})

app.post(`${SERVER_PREFIX}/payments/orders`, async (c) => {
  const body = (await readJson(c)) as {
    items?: Array<{
      id?: unknown
      quantity?: unknown
      selectedSize?: unknown
    }>
    customer?: {
      name?: unknown
      email?: unknown
      phone?: unknown
    }
    shipping?: {
      address?: unknown
      addressDetail?: unknown
      memo?: unknown
    }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, "주문 상품이 없습니다.")
  }
  if (body.items.length > 30) {
    throw new HttpError(400, "한 주문에 담을 수 있는 상품 종류를 초과했습니다.")
  }

  const requestedItems = body.items.map((requestedItem) => {
    const id = normalizeText(requestedItem.id, 64)
    const quantity = Number(requestedItem.quantity)
    if (
      !id ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new HttpError(400, "주문 상품 정보가 올바르지 않습니다.")
    }
    return { id, quantity, selectedSize: normalizeText(requestedItem.selectedSize, 100) || undefined }
  })

  const productIds = [...new Set(requestedItems.map((item) => item.id))]
  const { data: products, error: productsError } = await database()
    .from("products")
    .select("id, sku, name, price, status")
    .in("sku", productIds)
  if (productsError) throw new Error(`상품 조회 실패: ${productsError.message}`)
  const productsBySku = new Map((products ?? []).map((product) => [product.sku, product]))
  const items = requestedItems.map((item) => {
    const product = productsBySku.get(item.id)
    if (!product || product.status !== "active") {
      throw new HttpError(400, `구매할 수 없는 상품입니다: ${item.id}`)
    }
    return {
      id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity: item.quantity,
      selectedSize: item.selectedSize,
    }
  })

  const customer = {
    name: normalizeText(body.customer?.name, 100),
    email: normalizeText(body.customer?.email, 320) || undefined,
    phone: normalizeText(body.customer?.phone, 30),
  }
  const shipping = {
    address: normalizeText(body.shipping?.address, 500),
    addressDetail:
      normalizeText(body.shipping?.addressDetail, 500) || undefined,
    memo: normalizeText(body.shipping?.memo, 500) || undefined,
  }

  if (!customer.name || !customer.phone || !shipping.address) {
    throw new HttpError(400, "주문자와 배송 정보를 확인해주세요.")
  }
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw new HttpError(400, "이메일 형식이 올바르지 않습니다.")
  }

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  )
  const amount = subtotal + SHIPPING_FEE
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const orderName =
    itemCount === 1 ? items[0].name : `${items[0].name} 외 ${itemCount - 1}개`
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)
    .toUpperCase()
  const orderId = `PPIYO-${timestamp}-${random}`
  const pendingOrder: PendingOrder = {
    orderId,
    orderName,
    amount,
    customer,
    shipping,
    items,
    createdAt: new Date().toISOString(),
  }

  await kv.set(pendingKey(orderId), pendingOrder)
  return c.json({ orderId, orderName, amount }, 201)
})

app.post(`${SERVER_PREFIX}/payments/confirm`, async (c) => {
  const body = (await readJson(c)) as {
    paymentKey?: unknown
    orderId?: unknown
    amount?: unknown
  }
  const paymentKey = normalizeText(body.paymentKey, 300)
  const orderId = normalizeText(body.orderId, 100)
  const amount = Number(body.amount)

  if (!paymentKey || !orderId || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new HttpError(400, "결제 승인 정보가 올바르지 않습니다.")
  }

  const alreadySaved = await findSavedOrder(orderId)
  if (alreadySaved) {
    if (
      alreadySaved.toss_payment_key !== paymentKey ||
      alreadySaved.total_amount !== amount ||
      alreadySaved.payment_status !== "paid"
    ) {
      throw new HttpError(409, "이미 처리된 주문 정보와 일치하지 않습니다.")
    }
    return c.json({
      order: {
        orderId: alreadySaved.order_number,
        orderName: alreadySaved.order_name,
        amount: alreadySaved.total_amount,
        paymentStatus: "DONE",
        method: alreadySaved.method,
        approvedAt: alreadySaved.approved_at,
      },
    })
  }

  const pendingOrder = (await kv.get(
    pendingKey(orderId),
  )) as PendingOrder | undefined
  if (!pendingOrder) {
    throw new HttpError(404, "결제 대기 중인 주문을 찾을 수 없습니다.")
  }
  if (
    Date.now() - new Date(pendingOrder.createdAt).getTime() >
    CHECKOUT_TTL_MS
  ) {
    await kv.del(pendingKey(orderId))
    throw new HttpError(410, "결제 승인 가능 시간이 만료되었습니다.")
  }
  if (pendingOrder.orderId !== orderId || pendingOrder.amount !== amount) {
    throw new HttpError(
      400,
      "결제 금액이 서버의 주문 금액과 일치하지 않습니다.",
    )
  }

  const payment = await confirmTossPayment(paymentKey, orderId, amount)
  assertVerifiedPayment(payment, { paymentKey, orderId, amount })

  const { error } = await database().rpc("save_paid_order", {
    p_order_id: pendingOrder.orderId,
    p_order_name: pendingOrder.orderName,
    p_amount: pendingOrder.amount,
    p_payment_key: paymentKey,
    p_payment_status: payment.status,
    p_method: payment.method ?? "카드",
    p_approved_at: payment.approvedAt ?? new Date().toISOString(),
    p_customer_name: pendingOrder.customer.name,
    p_customer_email: pendingOrder.customer.email ?? null,
    p_customer_phone: pendingOrder.customer.phone,
    p_shipping_address: pendingOrder.shipping.address,
    p_shipping_address_detail: pendingOrder.shipping.addressDetail ?? null,
    p_shipping_memo: pendingOrder.shipping.memo ?? null,
    p_items: pendingOrder.items,
  })
  if (error) {
    // pending 주문을 남겨두어 승인 완료 결제를 안전하게 다시 저장할 수 있습니다.
    throw new Error(`승인 주문 저장 실패: ${error.message}`)
  }

  await kv.del(pendingKey(orderId))
  return c.json({
    order: {
      orderId: pendingOrder.orderId,
      orderName: pendingOrder.orderName,
      amount: pendingOrder.amount,
      paymentStatus: payment.status,
      method: payment.method,
      approvedAt: payment.approvedAt,
    },
  })
})

app.notFound((c) =>
  c.json({ message: "요청한 서버 경로를 찾을 수 없습니다." }, 404),
)

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ message: error.message }, error.status)
  }
  console.error("Server error:", error)
  return c.json(
    { message: "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
    500,
  )
})

Deno.serve(app.fetch)
