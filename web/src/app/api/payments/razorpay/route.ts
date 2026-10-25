import { fulfil, verifyWebhook } from "@/server/payments";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature"))) return new Response("Bad signature", { status: 400 });
  const evt = JSON.parse(raw) as {
    event: string;
    payload: { payment?: { entity: { id: string; order_id: string } } };
  };
  if (evt.event === "payment.captured" || evt.event === "order.paid") {
    const p = evt.payload.payment?.entity;
    if (p?.order_id) fulfil(p.order_id, p.id);
  }
  return new Response("ok");
}
