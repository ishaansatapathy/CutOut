import { PACKS } from "@/lib/rules";
import { addCredits } from "./billing";
import { config } from "./config";
import { hmacHex, id, safeEqual } from "./crypto";
import { db, now, tx } from "./db";

type Order = { id: string; user_id: string; pack: string; amount: number; credits: number; status: string };

export async function createOrder(userId: string, packId: string) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error("Unknown pack");
  const receipt = id();
  let orderId = `dev_${receipt}`;
  if (config.razorpay.id) {
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${config.razorpay.id}:${config.razorpay.secret}`).toString("base64"),
      },
      body: JSON.stringify({ amount: pack.price * 100, currency: "INR", receipt, notes: { userId, pack: pack.id } }),
    });
    if (!r.ok) throw new Error("Payment provider error. Try again.");
    orderId = ((await r.json()) as { id: string }).id;
  }
  await db.run(
    `INSERT INTO orders (id, user_id, pack, amount, credits, status, created_at) VALUES ($1, $2, $3, $4, $5, 'created', $6)`,
    [orderId, userId, pack.id, pack.price * 100, pack.credits, now()],
  );
  return { orderId, amount: pack.price * 100, keyId: config.razorpay.id || null, pack };
}

/** Idempotent: credits are granted once per order, whether via checkout callback or webhook. */
export function fulfil(orderId: string, paymentId: string) {
  return tx(async (x) => {
    const o = await x.get<Order>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    if (!o) return null;
    if (o.status !== "paid") {
      await x.run(`UPDATE orders SET status = 'paid', payment_id = $1 WHERE id = $2`, [paymentId, orderId]);
      await addCredits(o.user_id, o.credits, "purchase", orderId, x);
    }
    return o;
  });
}

export function verifyCheckout(orderId: string, paymentId: string, signature: string) {
  if (!config.razorpay.secret) return false;
  return safeEqual(hmacHex(config.razorpay.secret, `${orderId}|${paymentId}`), signature);
}

export function verifyWebhook(rawBody: string, signature: string | null) {
  if (!config.razorpay.webhook || !signature) return false;
  return safeEqual(hmacHex(config.razorpay.webhook, rawBody), signature);
}

export async function orderOwner(orderId: string) {
  return (await db.get<{ user_id: string }>(`SELECT user_id FROM orders WHERE id = $1`, [orderId]))?.user_id;
}
