import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "pickup_counter_webhook_secret_key_2026";

async function main() {
  const args = process.argv.slice(2);
  let orderId: string | undefined;
  let amountPaise: number | undefined;
  let eventId: string = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--orderId" && args[i + 1]) {
      orderId = args[++i];
    } else if (args[i] === "--amount" && args[i + 1]) {
      amountPaise = parseInt(args[++i], 10);
    } else if (args[i] === "--eventId" && args[i + 1]) {
      eventId = args[++i];
    }
  }

  // If orderId is not supplied, fetch the most recent order from server
  if (!orderId) {
    try {
      console.log("No --orderId specified. Looking for most recent order...");
      // Let's create a quick order if none provided
      const res = await fetch(`${API_URL}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ productId: "prod_chips", quantity: 1 }] }),
      });
      const data = await res.json();
      orderId = data.orderId;
      amountPaise = data.totalAmountPaise;
      console.log(`Auto-created order for demonstration: ${orderId} (₹${(amountPaise! / 100).toFixed(2)})`);
    } catch (e: any) {
      console.error("Could not auto-create order:", e.message);
      console.log("\nUsage: npm run send-webhook -- --orderId <ORDER_ID> [--amount <PAISE>] [--eventId <ID>]");
      process.exit(1);
    }
  }

  if (amountPaise === undefined) {
    // Fetch order details to get total
    const getRes = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId!)}`);
    if (getRes.ok) {
      const order = await getRes.json();
      amountPaise = order.totalAmountPaise;
    } else {
      amountPaise = 4000;
    }
  }

  const payload = {
    eventId,
    orderId,
    amountPaise,
    status: "captured",
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  console.log("\n=== Sending Signed Payment Webhook ===");
  console.log(`URL:         ${API_URL}/payments/webhook`);
  console.log(`X-Signature: ${signature}`);
  console.log(`Payload:    `, payload);

  try {
    const response = await fetch(`${API_URL}/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body: rawBody,
    });

    const result = await response.json();
    console.log(`Response [${response.status}]:`, result);

    if (response.ok) {
      console.log(`\nSUCCESS: Order ${orderId} marked as '${result.status}'. Locker claim is now unlocked!`);
    } else {
      console.error(`\nFAILED: Webhook was rejected with status ${response.status}`);
    }
  } catch (err: any) {
    console.error("Error sending webhook:", err.message);
  }
}

main();
