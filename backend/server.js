import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const HOLD_DURATION_SECONDS = parseInt(process.env.HOLD_DURATION_SECONDS || "120", 10);

// Configure PostgreSQL connection pool
export const pool = new pg.Pool({
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "snack_ordering_db",
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});

// Middleware
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root welcoming route
app.get("/", (req, res) => {
  res.json({
    message: "Snack Ordering Backend API is running successfully!",
    status: "online",
    database: process.env.DB_NAME || "snack_ordering_db",
    endpoints: {
      health: "/health",
      products: "/products",
      orders: "/orders",
      orderDetails: "/orders/:id",
      pickupClaim: "/orders/:id/pickup-claim"
    }
  });
});

// 1. Health check
app.get("/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as now");
    res.json({ status: "healthy", database: "connected", dbTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});


// Helper: Calculate available stock (physical stock minus reservations from active pending orders)
async function getProductsWithAvailableStock(client = pool) {
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
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    pricePaise: Number(row.pricePaise),
    availableStock: Math.max(0, Number(row.stock) - Number(row.reservedStock)),
  }));
}

// 2. GET /products: Fetch products with real-time available stock
app.get("/products", async (req, res) => {
  try {
    const products = await getProductsWithAvailableStock();
    res.json(products);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Failed to fetch products from database" });
  }
});

// 3. POST /products: Add a new snack product to PostgreSQL
app.post("/products", async (req, res) => {
  try {
    const { id, name, pricePaise, stock } = req.body;
    if (!name || pricePaise === undefined) {
      return res.status(400).json({ error: "Product name and pricePaise are required" });
    }

    const productId = id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const parsedPrice = parseInt(pricePaise, 10);
    const parsedStock = parseInt(stock || "0", 10);

    const query = `
      INSERT INTO products (id, name, price_paise, stock)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, price_paise AS "pricePaise", stock AS "availableStock";
    `;
    const result = await pool.query(query, [productId, name, parsedPrice, parsedStock]);

    console.log(`Product added to database:`, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error adding product:", err);
    res.status(500).json({ error: "Failed to insert product into database", details: err.message });
  }
});

// 4. POST /orders: Place a new order with reservation timer
app.post("/orders", async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Order must contain at least one item." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch products and verify available stock
    const products = await getProductsWithAvailableStock(client);
    const productMap = new Map(products.map((p) => [p.id, p]));

    let totalAmountPaise = 0;
    for (const item of items) {
      const prod = productMap.get(item.productId);
      if (!prod) {
        throw new Error(`Product ${item.productId} was not found.`);
      }
      if (item.quantity <= 0) {
        throw new Error(`Invalid quantity for ${prod.name}.`);
      }
      if (item.quantity > prod.availableStock) {
        throw new Error(`Insufficient stock for ${prod.name}. Only ${prod.availableStock} available.`);
      }
      totalAmountPaise += prod.pricePaise * item.quantity;
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAtQuery = `NOW() + INTERVAL '${HOLD_DURATION_SECONDS} seconds'`;

    // Insert order
    const insertOrderQuery = `
      INSERT INTO orders (id, status, total_amount_paise, expires_at, claimed)
      VALUES ($1, 'pending', $2, ${expiresAtQuery}, false)
      RETURNING id, status, total_amount_paise AS "totalAmountPaise", 
                ROUND(EXTRACT(EPOCH FROM (expires_at - NOW())))::INTEGER AS "expiresInSeconds";
    `;
    const orderResult = await client.query(insertOrderQuery, [orderId, totalAmountPaise]);
    const createdOrder = orderResult.rows[0];

    // Insert order items
    for (const item of items) {
      const prod = productMap.get(item.productId);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4);`,
        [orderId, item.productId, item.quantity, prod.pricePaise]
      );
    }

    await client.query("COMMIT");

    console.log(`Order created in database: ${orderId} total: ${totalAmountPaise} paise`);
    res.status(201).json({
      orderId: createdOrder.id,
      totalAmountPaise: Number(createdOrder.totalAmountPaise),
      status: createdOrder.status,
      expiresInSeconds: Number(createdOrder.expiresInSeconds),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Order creation failed:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 5. GET /orders/:id: Retrieve order status with live server countdown
app.get("/orders/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // Check if expired and update if needed
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
    const orderResult = await pool.query(orderQuery, [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderResult.rows[0];

    // Fetch items with product names
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
    const itemsResult = await pool.query(itemsQuery, [id]);

    res.json({
      id: order.id,
      status: order.status,
      totalAmountPaise: Number(order.totalAmountPaise),
      expiresInSeconds: order.expiresInSeconds !== null ? Number(order.expiresInSeconds) : null,
      claimed: Boolean(order.claimed),
      items: itemsResult.rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        quantity: Number(row.quantity),
        unitPricePaise: Number(row.unitPricePaise),
      })),
    });
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ error: "Failed to retrieve order details" });
  }
});

// 6. POST /orders/:id/pickup-claim: Unlock locker and claim order
app.post("/orders/:id/pickup-claim", async (req, res) => {
  const { id } = req.params;
  try {
    const check = await pool.query("SELECT status, claimed FROM orders WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = check.rows[0];
    if (order.status !== "paid") {
      return res.status(400).json({ error: "Only paid orders can be claimed from the locker." });
    }
    if (order.claimed) {
      return res.status(400).json({ error: "This order has already been claimed." });
    }

    await pool.query("UPDATE orders SET claimed = true WHERE id = $1", [id]);
    console.log(`Locker claimed for order: ${id}`);
    res.json({ success: true, status: "claimed" });
  } catch (err) {
    console.error("Error claiming order:", err);
    res.status(500).json({ error: "Failed to claim pickup" });
  }
});

// 7. POST /orders/:id/status: Simulate status changes (Paid, Expired, Needs Review)
app.post("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ["pending", "paid", "expired", "needs_review"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${valid.join(", ")}` });
  }

  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status, claimed;`,
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    console.log(`Order ${id} status updated to: ${status}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

// 8. POST /webhook/payment: Simulate payment gateway webhook
app.post("/webhook/payment", async (req, res) => {
  const { orderId, amountPaise } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  try {
    const orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    const order = orderRes.rows[0];

    let newStatus = "paid";
    if (amountPaise !== undefined && Number(amountPaise) !== Number(order.total_amount_paise)) {
      newStatus = "needs_review";
    }

    await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [newStatus, orderId]);
    console.log(`Webhook handled: Order ${orderId} marked as ${newStatus}`);
    res.json({ success: true, orderId, status: newStatus });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Start listening
const server = app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Snack Ordering Backend running on port ${PORT}`);
  console.log(`  Connected to PostgreSQL: ${process.env.DB_NAME || "snack_ordering_db"}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`===============================================`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down backend...");
  await pool.end();
  server.close(() => {
    console.log("Server stopped.");
    process.exit(0);
  });
});
