import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { pool, initializeDatabase } from "./db/index.js";
import type { CartLine, OrderDetails, OrderStatus, Product, WebhookPayload } from "./types.js";

dotenv.config();

export const app = express();
const PORT = Number(process.env.PORT) || 4000;
const HOLD_DURATION_SECONDS = parseInt(process.env.HOLD_DURATION_SECONDS || "120", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "pickup_counter_webhook_secret_key_2026";

// Capture raw body buffer for HMAC-SHA256 signature verification
interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Signature"],
  })
);

app.use(
  express.json({
    verify: (req: RequestWithRawBody, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

// Logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root welcoming route
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Pickup Counter Express API",
    status: "online",
    version: "1.0.0",
    database: "PostgreSQL connected",
    endpoints: {
      health: "GET /health",
      products: "GET /products",
      createOrder: "POST /orders",
      orderDetails: "GET /orders/:id",
      pickupClaim: "POST /orders/:id/pickup-claim",
      webhook: "POST /payments/webhook",
      simulateStatus: "POST /orders/:id/status",
    },
  });
});

// Health check endpoint
app.get("/health", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT NOW() as now, current_database() as db");
    res.json({
      status: "healthy",
      database: result.rows[0].db,
      dbTime: result.rows[0].now,
    });
  } catch (err: any) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

// Helper: Get available stock (physical stock minus units held by active unexpired pending orders)
async function getProductsCatalog(client: any = pool): Promise<Product[]> {
  const query = `
    SELECT 
      p.id,
      p.name,
      p.price_paise AS "pricePaise",
      p.stock,
      COALESCE(SUM(
        CASE 
          WHEN o.status = 'pending' AND o.expires_at > NOW() 
          THEN oi.quantity 
          ELSE 0 
        END
      ), 0)::INTEGER AS "reservedStock"
    FROM products p
    LEFT JOIN order_items oi ON oi.product_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id
    GROUP BY p.id, p.name, p.price_paise, p.stock
    ORDER BY p.name ASC;
  `;
  const result = await client.query(query);
  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    pricePaise: Number(row.pricePaise),
    availableStock: Math.max(0, Number(row.stock) - Number(row.reservedStock)),
  }));
}

// 1. GET /products: Catalog with real-time available stock
app.get("/products", async (_req: Request, res: Response) => {
  try {
    const products = await getProductsCatalog();
    res.json(products);
  } catch (err: any) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// POST /products: Add or update a product
app.post("/products", async (req: Request, res: Response) => {
  try {
    const { id, name, pricePaise, stock } = req.body;
    if (!name || pricePaise === undefined) {
      return res.status(400).json({ error: "Product name and pricePaise are required" });
    }

    const productId = id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const query = `
      INSERT INTO products (id, name, price_paise, stock)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price_paise = EXCLUDED.price_paise, stock = EXCLUDED.stock
      RETURNING id, name, price_paise AS "pricePaise", stock AS "availableStock";
    `;
    const result = await pool.query(query, [
      productId,
      name,
      parseInt(pricePaise, 10),
      parseInt(stock || "0", 10),
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /orders: Place order with concurrency-safe stock reservation
app.post("/orders", async (req: Request, res: Response) => {
  const { items } = req.body as { items: CartLine[] };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Order must contain at least one item." });
  }

  // Aggregate items by productId in case duplicate lines are sent
  const aggregated: Record<string, number> = {};
  for (const it of items) {
    if (!it.productId || it.quantity <= 0) {
      return res.status(400).json({ error: "Invalid item or quantity." });
    }
    aggregated[it.productId] = (aggregated[it.productId] || 0) + it.quantity;
  }

  const productIds = Object.keys(aggregated);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Concurrency Lock: Lock requested product rows in consistent order to prevent deadlocks
    const lockQuery = `
      SELECT id, name, price_paise AS "pricePaise", stock
      FROM products
      WHERE id = ANY($1)
      ORDER BY id ASC
      FOR UPDATE;
    `;
    const lockedProds = await client.query(lockQuery, [productIds]);
    const prodMap = new Map<string, { id: string; name: string; pricePaise: number; stock: number }>(
      lockedProds.rows.map((p: any) => [
        p.id,
        { id: p.id, name: p.name, pricePaise: Number(p.pricePaise), stock: Number(p.stock) },
      ])
    );

    // Verify all products exist
    for (const pid of productIds) {
      if (!prodMap.has(pid)) {
        throw new Error(`Product ${pid} was not found.`);
      }
    }

    // Calculate current reserved quantities from active pending holds
    const reservedQuery = `
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS "reserved"
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ANY($1)
        AND o.status = 'pending'
        AND o.expires_at > NOW()
      GROUP BY oi.product_id;
    `;
    const reservedRes = await client.query(reservedQuery, [productIds]);
    const reservedMap = new Map<string, number>(
      reservedRes.rows.map((r: any) => [r.product_id, Number(r.reserved)])
    );

    // Check available stock for each product
    let totalAmountPaise = 0;
    for (const pid of productIds) {
      const prod = prodMap.get(pid)!;
      const requestedQty = aggregated[pid];
      const currentlyReserved = reservedMap.get(pid) || 0;
      const available = Math.max(0, prod.stock - currentlyReserved);

      if (requestedQty > available) {
        throw new Error(`Insufficient stock for ${prod.name}. Only ${available} units available.`);
      }
      totalAmountPaise += prod.pricePaise * requestedQty;
    }

    // Insert order with server-measured expiry
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const insertOrderQuery = `
      INSERT INTO orders (id, status, total_amount_paise, expires_at, claimed)
      VALUES ($1, 'pending', $2, NOW() + INTERVAL '${HOLD_DURATION_SECONDS} seconds', false)
      RETURNING id, status, total_amount_paise AS "totalAmountPaise",
                ROUND(EXTRACT(EPOCH FROM (expires_at - NOW())))::INTEGER AS "expiresInSeconds";
    `;
    const orderRes = await client.query(insertOrderQuery, [orderId, totalAmountPaise]);
    const created = orderRes.rows[0];

    // Insert order items
    for (const pid of productIds) {
      const prod = prodMap.get(pid)!;
      const qty = aggregated[pid];
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4);`,
        [orderId, pid, qty, prod.pricePaise]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      orderId: created.id,
      totalAmountPaise: Number(created.totalAmountPaise),
      status: created.status,
      expiresInSeconds: Number(created.expiresInSeconds),
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 3. GET /orders/:id: Retrieve order status with monotonic server-clock countdown
app.get("/orders/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Automatically transition expired pending holds
    await pool.query(
      `UPDATE orders 
       SET status = 'expired' 
       WHERE id = $1 AND status = 'pending' AND expires_at <= NOW();`,
      [id]
    );

    const orderQuery = `
      SELECT 
        o.id,
        o.status,
        o.total_amount_paise AS "totalAmountPaise",
        o.claimed,
        CASE 
          WHEN o.status = 'pending' THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (o.expires_at - NOW())))::INTEGER)
          ELSE NULL 
        END AS "expiresInSeconds"
      FROM orders o
      WHERE o.id = $1;
    `;
    const orderRes = await pool.query(orderQuery, [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderRes.rows[0];

    const itemsQuery = `
      SELECT 
        oi.product_id AS "productId",
        p.name,
        oi.quantity,
        oi.unit_price_paise AS "unitPricePaise"
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1;
    `;
    const itemsRes = await pool.query(itemsQuery, [id]);

    res.json({
      id: order.id,
      status: order.status as OrderStatus,
      totalAmountPaise: Number(order.totalAmountPaise),
      expiresInSeconds: order.expiresInSeconds !== null ? Number(order.expiresInSeconds) : null,
      claimed: Boolean(order.claimed),
      items: itemsRes.rows.map((row: any) => ({
        productId: row.productId,
        name: row.name,
        quantity: Number(row.quantity),
        unitPricePaise: Number(row.unitPricePaise),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /payments/webhook: Validated HMAC-SHA256 webhook with idempotency & late-payment handling
app.post("/payments/webhook", async (req: RequestWithRawBody, res: Response) => {
  const signatureHeader = req.headers["x-signature"] as string | undefined;

  if (!signatureHeader || !req.rawBody) {
    return res.status(401).json({ error: "Missing webhook signature or body." });
  }

  // 1. Verify HMAC-SHA256 signature
  const expectedSig = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  const sigBuffer = Buffer.from(signatureHeader.trim().toLowerCase());
  const expectedBuffer = Buffer.from(expectedSig.toLowerCase());

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return res.status(401).json({ error: "Invalid signature: HMAC-SHA256 verification failed." });
  }

  const payload = req.body as WebhookPayload;
  const { eventId, orderId, amountPaise, status } = payload;

  if (!eventId || !orderId || amountPaise === undefined) {
    return res.status(400).json({ error: "Invalid payload: eventId, orderId, and amountPaise are required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 2. Idempotency Check: Was this webhook eventId already processed?
    const processedCheck = await client.query(
      "SELECT event_id, status FROM processed_webhooks WHERE event_id = $1",
      [eventId]
    );

    if (processedCheck.rows.length > 0) {
      await client.query("COMMIT");
      console.log(`Duplicate webhook eventId '${eventId}' received — returned idempotent 200 OK.`);
      return res.status(200).json({
        success: true,
        message: "Duplicate event received, already processed.",
        eventId,
      });
    }

    // 3. Lock the order row
    const orderRes = await client.query(
      "SELECT id, status, total_amount_paise AS \"totalAmountPaise\", expires_at FROM orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: `Order ${orderId} not found.` });
    }

    const order = orderRes.rows[0];
    const orderTotal = Number(order.totalAmountPaise);
    const isExpired = order.status === "expired" || (order.status === "pending" && new Date(order.expires_at) <= new Date());

    let resultingStatus: OrderStatus = "paid";

    // 4. Check if amount matches
    if (Number(amountPaise) !== orderTotal) {
      resultingStatus = "needs_review";
      console.log(`Payment amount mismatch for order ${orderId}: expected ${orderTotal}, received ${amountPaise}`);
    } else if (isExpired) {
      // 5. Late Payment Decision:
      // If payment arrives after hold expired, verify if stock is still available:
      // - If units are still in stock: re-grant hold and mark as 'paid'.
      // - If units were already sold/held by someone else: mark as 'needs_review' so staff can refund.
      const catalog = await getProductsCatalog(client);
      const itemsRes = await client.query(
        "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
        [orderId]
      );
      let canFulfill = true;
      for (const it of itemsRes.rows) {
        const prod = catalog.find((c) => c.id === it.product_id);
        if (!prod || prod.availableStock < it.quantity) {
          canFulfill = false;
          break;
        }
      }

      if (canFulfill) {
        resultingStatus = "paid";
        console.log(`Late payment for order ${orderId}: Stock still available, marked 'paid'.`);
      } else {
        resultingStatus = "needs_review";
        console.log(`Late payment for order ${orderId}: Stock was re-allocated, marked 'needs_review' for staff refund.`);
      }
    } else {
      resultingStatus = "paid";
    }

    // Update order status
    await client.query("UPDATE orders SET status = $1 WHERE id = $2", [resultingStatus, orderId]);

    // Record webhook event for idempotency
    await client.query(
      "INSERT INTO processed_webhooks (event_id, order_id, status) VALUES ($1, $2, $3)",
      [eventId, orderId, resultingStatus]
    );

    await client.query("COMMIT");

    res.status(200).json({
      success: true,
      eventId,
      orderId,
      status: resultingStatus,
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Failed to process webhook" });
  } finally {
    client.release();
  }
});

// 5. POST /orders/:id/pickup-claim: Concurrency-safe locker claim with 409 Conflict
app.post("/orders/:id/pickup-claim", async (req: Request, res: Response) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Concurrency Lock: Lock order row for update
    const orderRes = await client.query(
      "SELECT id, status, claimed FROM orders WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    const order = orderRes.rows[0];

    // Must be paid
    if (order.status !== "paid") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Cannot claim pickup: order status is '${order.status}'. Only paid orders can be claimed.`,
      });
    }

    // Check if already claimed -> 409 Conflict (essential for simultaneous locker calls)
    if (order.claimed) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "409 Conflict: This order has already been claimed from a locker.",
      });
    }

    // Mark claimed
    await client.query("UPDATE orders SET claimed = true WHERE id = $1", [id]);

    // Permanently deduct physical stock from products table
    await client.query(
      `UPDATE products p
       SET stock = stock - oi.quantity
       FROM order_items oi
       WHERE oi.order_id = $1 AND oi.product_id = p.id`,
      [id]
    );

    await client.query("COMMIT");

    console.log(`Locker successfully claimed for order: ${id}. Physical stock permanently reduced.`);
    res.json({ success: true, status: "claimed", message: "Locker opened. Enjoy your snacks!" });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 6. POST /orders/:id/status: Helper route for quick interactive simulation testing
app.post("/orders/:id/status", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as { status: OrderStatus };
  const validStatuses: OrderStatus[] = ["pending", "paid", "expired", "needs_review"];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(", ")}` });
  }

  try {
    const resUpdate = await pool.query(
      "UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status, claimed",
      [status, id]
    );
    if (resUpdate.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(resUpdate.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
export async function startServer() {
  await initializeDatabase();
  return app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`  Pickup Counter Backend running on port ${PORT}`);
    console.log(`  Connected to PostgreSQL: ${process.env.DB_NAME || "snack_ordering_db"}`);
    console.log(`  Webhook Secret: Configured`);
    console.log(`  Health Check: http://localhost:${PORT}/health`);
    console.log(`===============================================`);
  });
}

// Auto-start if executed directly
if (process.env.NODE_ENV !== "test") {
  startServer();
}
