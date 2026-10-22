import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "snack_ordering_db",
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle database client", err);
});

export async function initializeDatabase(): Promise<void> {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(50) PRIMARY KEY,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      total_amount_paise INTEGER NOT NULL CHECK (total_amount_paise >= 0),
      expires_at TIMESTAMP WITH TIME ZONE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(50) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id VARCHAR(50) NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0)
    );

    CREATE TABLE IF NOT EXISTS processed_webhooks (
      event_id VARCHAR(100) PRIMARY KEY,
      order_id VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL,
      processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO products (id, name, price_paise, stock) VALUES
      ('prod_chips', 'Masala Chips', 4000, 20),
      ('prod_peanuts', 'Salted Peanuts', 2500, 15),
      ('prod_cookies', 'Choco Cookies', 5000, 10),
      ('prod_namkeen', 'Namkeen Mix', 3500, 25),
      ('prod_chocobar', 'Chocolate Bar', 6000, 8)
    ON CONFLICT (id) DO NOTHING;
  `;

  await pool.query(schemaSql);
  console.log("PostgreSQL schema and seed products verified.");
}
