import dns from "dns";
import https from "https";
import { PACKS } from "@/lib/rules";
import { addCredits } from "./billing";
import { config } from "./config";
import { hmacHex, id, safeEqual } from "./crypto";
import { db, now, tx } from "./db";

type Order = { id: string; user_id: string; pack: string; amount: number; credits: number; status: string };

import type { LookupFunction } from "net";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Ignore if not supported in runtime
}

const customLookup: LookupFunction = (hostname, options, callback) => {
  dns.resolve4(hostname, (err, addrs) => {
    if (err || !addrs || !addrs[0]) {
      return (dns.lookup as unknown as LookupFunction)(hostname, options, callback);
    }
    if (typeof options === "object" && options.all) {
      (callback as (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(
        null,
        addrs.map((a) => ({ address: a, family: 4 })),
      );
    } else {
      (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(null, addrs[0], 4);
    }
  });
};

function razorpayPost<T>(path: string, bodyObj: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${config.razorpay.id}:${config.razorpay.secret}`).toString("base64");
    const payload = JSON.stringify(bodyObj);
    const req = https.request(
      {
        host: "api.razorpay.com",
        path,
        method: "POST",
        lookup: customLookup,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 12000,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(text);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data as T);
            } else {
              reject(new Error(data?.error?.description || `Razorpay error (${res.statusCode}): ${text}`));
            }
          } catch {
            reject(new Error(`Razorpay returned non-JSON response (${res.statusCode})`));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Razorpay connection timed out. Please try again."));
    });
    req.on("error", (err) => reject(new Error(`Razorpay connection error: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

export async function createOrder(userId: string, packId: string) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error("Unknown pack");
  const receipt = id();
  let orderId = `dev_${receipt}`;
  if (config.razorpay.id) {
    const res = await razorpayPost<{ id: string }>("/v1/orders", {
      amount: pack.price * 100,
      currency: "INR",
      receipt,
      notes: { userId, pack: pack.id },
    });
    orderId = res.id;
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
