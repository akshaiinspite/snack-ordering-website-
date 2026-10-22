# Pickup Counter — Self-Service Snack Ordering System

A full-stack, concurrency-hardened snack ordering and automated locker pickup counter built with **TypeScript**, **Node.js (Express)**, **React (Vite)**, and **PostgreSQL**.

---

## Quick Start (One-Command Startup)

### Option A: Docker Compose (Recommended)
To start PostgreSQL, the TypeScript backend API, and the React frontend in a single command:

```bash
docker compose up --build
```

- **Frontend Customer Screen:** http://localhost:5173
- **Backend API:** http://localhost:4000
- **PostgreSQL Database:** localhost:5432 (`snack_ordering_db`)

---

### Option B: Run Locally

#### 1. Setup Backend
```bash
cd backend
npm install
npm run dev
```
*(Runs on `http://localhost:4000` with hot-reloading)*

#### 2. Setup Frontend
```bash
cd ../frontend
npm install
npm run dev
```
*(Runs on `http://localhost:5173`)*

---

## Automated Concurrency Tests (Proof Under Pressure)

The assignment requires automated tests running against a **real PostgreSQL database** (no mocks) proving:
1. **10 concurrent customers** ordering the last 2 units at the same instant: exactly 2 units held, 8 rejected cleanly without over-allocation.
2. **Duplicate webhook event** sent twice: processed once idempotently without altering state.
3. **Two simultaneous pickup claims**: exactly one succeeds (200 OK) while the other receives `409 Conflict`, with physical stock decremented accurately.

To execute the suite:

```bash
cd backend
npm test
```

Sample output:
```text
============================================================
  TEST 1: Ten Customers Ordering Last 2 Units Concurrently
============================================================
Firing 10 concurrent customer order requests at the same millisecond...
Results: 2 orders succeeded, 8 orders failed cleanly.
>>> TEST 1 PASSED: Exactly 2 units held, 8 rejected cleanly without overselling! <<<

============================================================
  TEST 2: Duplicate Webhook Event Idempotency
============================================================
Sending webhook 1st time for eventId 'evt_idempotent_...'... Status: 200
Sending EXACT same webhook 2nd time (duplicate delivery)... Status: 200
>>> TEST 2 PASSED: Duplicate webhook event processed once and returned safely! <<<

============================================================
  TEST 3: Simultaneous Locker Pickup Claims (409 Conflict)
============================================================
Locker #1 returned status 200: { status: 'claimed' }
Locker #2 returned status 409: { error: '409 Conflict: This order has already been claimed' }
>>> TEST 3 PASSED: Exactly 1 pickup succeeded, 2nd received 409 Conflict, physical stock decremented accurately! <<<
```

---

## Simulating the Payment Webhook

To send an **HMAC-SHA256 signed payment webhook** with the `X-Signature` header:

```bash
cd backend
npm run send-webhook -- --orderId <ORDER_ID>
```
*(If `--orderId` is omitted, the script automatically creates a fresh order and pays for it).*

Options:
- `--orderId <id>`: Target order ID.
- `--amount <paise>`: Simulated payment amount in whole paise (can test mismatched amounts).
- `--eventId <id>`: Custom event ID (can test duplicate webhook delivery).

---

## Architecture & Hard Decisions

### 1. The Late-Payment Question (Design Decision)
> *What happens when a valid payment arrives after the hold has expired and the units may already be sold to someone else?*

**Our Choice:**
When a captured webhook arrives for an expired order:
1. The server checks if the requested items are **still physically available in unreserved stock**.
2. **If available:** The order is granted stock and marked as `paid`. The customer can immediately claim their snacks from the locker without friction.
3. **If already sold or held by someone else:** The order is marked as `needs_review` rather than `paid`. The customer screen clearly alerts them: *"Payment received after hold expired; staff assistance or auto-refund initiated"*. The locker remains locked to prevent dispensing items that aren't physically present.

**Why:**
This approach maximizes customer satisfaction by fulfilling the order whenever inventory permits, while strictly preventing stock deficits or duplicate dispensing when stock has already been claimed by another buyer.

---

### 2. Concurrency & Race-Condition Hardening
- **Order Placement (`POST /orders`):** Uses database-level row locks (`SELECT ... FOR UPDATE`) in an atomic transaction. Product IDs are locked in alphabetical order to eliminate deadlock possibilities. Active reservations (`expires_at > NOW()`) are computed inside the lock so simultaneous orders queue up and see updated stock instantly.
- **Locker Pickups (`POST /orders/:id/pickup-claim`):** Uses `SELECT status, claimed FROM orders WHERE id = $1 FOR UPDATE`. When two lockers call simultaneously, the first acquires the lock, sets `claimed = true`, and commits. The second transaction wakes up, reads `claimed = true`, rolls back, and issues a **`409 Conflict`**.
- **HMAC-SHA256 Verification:** The raw request body buffer is captured before JSON parsing to guarantee cryptographic byte-for-byte signature match using timing-safe buffer comparisons (`crypto.timingSafeEqual`).
- **Webhook Idempotency:** The `processed_webhooks` table tracks processed `eventId` keys. Duplicate deliveries safely return `200 OK` without triggering duplicate status mutations.

---

### 3. Customer Screen Clock Skew Resilience
A self-service kiosk or customer device clock may be drifted by minutes. The customer screen:
1. Receives `expiresInSeconds` calculated strictly by the PostgreSQL server clock.
2. Uses a local monotonic high-resolution timer (`performance.now()`) anchored to the server-provided duration.
3. Does **not** rely on `Date.now()` or device wall-clock adjustments.

---

### 4. Assumptions Made
- All money is denominated in integer **paise** (e.g. ₹40.00 = `4000`).
- Locker pickup claim is permanent: physical stock is decremented at the exact moment of locker claim.
- The webhook secret is shared between payment provider and counter via `WEBHOOK_SECRET`.

---

### 5. What We Would Add Next With More Time
- Redis-based distributed locking (Redlock) if scaling across multiple stateless backend container replicas.
- Automated webhook retry queue with exponential backoff and dead-letter queue.
- WebSocket or Server-Sent Events (SSE) for zero-latency status push instead of 3-second polling.
