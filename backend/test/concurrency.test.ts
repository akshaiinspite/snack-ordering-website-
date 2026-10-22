import crypto from "crypto";
import dotenv from "dotenv";
import { pool, initializeDatabase } from "../src/db/index.js";

dotenv.config();

const BASE_URL = process.env.API_URL || "http://localhost:4000";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "pickup_counter_webhook_secret_key_2026";

function printHeader(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function runTests() {
  console.log("Starting Concurrency & Correctness Tests against real PostgreSQL...");
  await initializeDatabase();

  let passed = 0;
  let failed = 0;

  // -------------------------------------------------------------
  // TEST 1: Ten customers ordering the last two units simultaneously
  // -------------------------------------------------------------
  printHeader("TEST 1: Ten Customers Ordering Last 2 Units Concurrently");
  try {
    const testProdId = `prod_test_concurrency_${Date.now()}`;
    await pool.query(
      "INSERT INTO products (id, name, price_paise, stock) VALUES ($1, $2, $3, $4)",
      [testProdId, "Limited Edition Snack", 2500, 2]
    );

    console.log(`Created test product '${testProdId}' with exactly 2 units in stock.`);
    console.log("Firing 10 concurrent customer order requests at the same millisecond...");

    const orderPromises = Array.from({ length: 10 }).map((_, idx) =>
      fetch(`${BASE_URL}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: testProdId, quantity: 1 }],
        }),
      }).then(async (res) => ({
        index: idx + 1,
        status: res.status,
        data: await res.json(),
      }))
    );

    const results = await Promise.all(orderPromises);

    const successes = results.filter((r) => r.status === 201);
    const failures = results.filter((r) => r.status === 400);

    console.log(`Results: ${successes.length} orders succeeded, ${failures.length} orders failed cleanly.`);
    successes.forEach((s) => console.log(`  ✓ Customer #${s.index} succeeded: Order ID ${s.data.orderId}`));
    failures.forEach((f) => console.log(`  ✗ Customer #${f.index} rejected: ${f.data.error}`));

    if (successes.length !== 2 || failures.length !== 8) {
      throw new Error(`Expected exactly 2 successes and 8 failures, got ${successes.length} / ${failures.length}`);
    }

    // Verify in PostgreSQL: available stock must be 0
    const catRes = await fetch(`${BASE_URL}/products`);
    const catalog = await catRes.json();
    const prod = catalog.find((p: any) => p.id === testProdId);
    if (!prod || prod.availableStock !== 0) {
      throw new Error(`Available stock should be 0, but is ${prod?.availableStock}`);
    }

    console.log(`\n>>> TEST 1 PASSED: Exactly 2 units held, 8 rejected cleanly without overselling! <<<`);
    passed++;
  } catch (err: any) {
    console.error(`\n>>> TEST 1 FAILED: ${err.message}`);
    failed++;
  }

  // -------------------------------------------------------------
  // TEST 2: Duplicate webhook idempotency
  // -------------------------------------------------------------
  printHeader("TEST 2: Duplicate Webhook Event Idempotency");
  try {
    // Create an order first
    const orderRes = await fetch(`${BASE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "prod_chips", quantity: 1 }],
      }),
    });
    const order = await orderRes.json();
    const eventId = `evt_idempotent_${Date.now()}`;

    const payload = {
      eventId,
      orderId: order.orderId,
      amountPaise: order.totalAmountPaise,
      status: "captured",
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

    console.log(`Sending webhook 1st time for eventId '${eventId}'...`);
    const firstRes = await fetch(`${BASE_URL}/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": signature },
      body: rawBody,
    });
    const firstJson = await firstRes.json();
    console.log(`  1st Webhook Status: ${firstRes.status}`, firstJson);

    console.log(`Sending EXACT same webhook 2nd time (duplicate delivery)...`);
    const secondRes = await fetch(`${BASE_URL}/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": signature },
      body: rawBody,
    });
    const secondJson = await secondRes.json();
    console.log(`  2nd Webhook Status: ${secondRes.status}`, secondJson);

    if (firstRes.status !== 200 || secondRes.status !== 200) {
      throw new Error(`Expected 200 for both webhooks, got ${firstRes.status} and ${secondRes.status}`);
    }

    if (!secondJson.message?.includes("already processed") && secondJson.success !== true) {
      throw new Error("Second call was not handled as an idempotent duplicate.");
    }

    // Verify in PostgreSQL: exactly 1 record in processed_webhooks
    const dbCheck = await pool.query("SELECT * FROM processed_webhooks WHERE event_id = $1", [eventId]);
    if (dbCheck.rows.length !== 1) {
      throw new Error(`Expected 1 entry in processed_webhooks, found ${dbCheck.rows.length}`);
    }

    console.log(`\n>>> TEST 2 PASSED: Duplicate webhook event processed once and returned safely! <<<`);
    passed++;
  } catch (err: any) {
    console.error(`\n>>> TEST 2 FAILED: ${err.message}`);
    failed++;
  }

  // -------------------------------------------------------------
  // TEST 3: Two simultaneous locker pickup claims (409 Conflict)
  // -------------------------------------------------------------
  printHeader("TEST 3: Simultaneous Locker Pickup Claims (409 Conflict)");
  try {
    const testProdId = `prod_locker_${Date.now()}`;
    await pool.query(
      "INSERT INTO products (id, name, price_paise, stock) VALUES ($1, $2, $3, $4)",
      [testProdId, "Locker Test Snack", 1500, 10]
    );

    // Create an order for 2 units
    const orderRes = await fetch(`${BASE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: testProdId, quantity: 2 }],
      }),
    });
    const order = await orderRes.json();

    // Mark it paid via webhook
    const rawBody = JSON.stringify({
      eventId: `evt_locker_${Date.now()}`,
      orderId: order.orderId,
      amountPaise: order.totalAmountPaise,
      status: "captured",
    });
    const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    await fetch(`${BASE_URL}/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": sig },
      body: rawBody,
    });

    console.log(`Order ${order.orderId} is paid. Firing 2 simultaneous pickup-claim requests...`);

    const claimCalls = [1, 2].map((id) =>
      fetch(`${BASE_URL}/orders/${order.orderId}/pickup-claim`, {
        method: "POST",
      }).then(async (res) => ({
        caller: `Locker #${id}`,
        status: res.status,
        data: await res.json(),
      }))
    );

    const claimResults = await Promise.all(claimCalls);
    claimResults.forEach((r) => console.log(`  ${r.caller} returned status ${r.status}:`, r.data));

    const successes = claimResults.filter((r) => r.status === 200);
    const conflicts = claimResults.filter((r) => r.status === 409);

    if (successes.length !== 1 || conflicts.length !== 1) {
      throw new Error(`Expected exactly one 200 and one 409, got ${successes.length} 200s and ${conflicts.length} 409s`);
    }

    // Verify physical stock in PostgreSQL: originally 10, should now be exactly 8 (not 6)
    const stockRes = await pool.query("SELECT stock FROM products WHERE id = $1", [testProdId]);
    const finalStock = Number(stockRes.rows[0].stock);
    if (finalStock !== 8) {
      throw new Error(`Physical stock should have reduced by 2 (to 8), but is ${finalStock}`);
    }

    console.log(`\n>>> TEST 3 PASSED: Exactly 1 pickup succeeded, 2nd received 409 Conflict, physical stock decremented accurately! <<<`);
    passed++;
  } catch (err: any) {
    console.error(`\n>>> TEST 3 FAILED: ${err.message}`);
    failed++;
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  printHeader("TEST SUITE SUMMARY");
  console.log(`Total: 3 tests | Passed: ${passed} | Failed: ${failed}`);
  if (failed === 0) {
    console.log("🎉 ALL CONCURRENCY AND HARD-PART TESTS PASSED ON REAL POSTGRESQL!\n");
  } else {
    console.error("❌ SOME TESTS FAILED.\n");
    process.exit(1);
  }

  await pool.end();
}

runTests();
