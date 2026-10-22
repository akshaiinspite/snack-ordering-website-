# AI Notes — Pickup Counter Development

## 1. AI Tools Used and Purpose

- **Antigravity / Gemini 3.8**: Used as an AI pair programmer for scaffolding the full-stack architecture, writing TypeScript typings, setting up PostgreSQL schemas, and constructing the automated concurrency test suite.
- **Claude / Cursor**: Used for reviewing edge cases in transaction isolation levels and optimizing countdown timer resilience against client clock skew.

---

## 2. One Prompt That Worked Well

> *"Write an automated test in TypeScript that fires 10 simultaneous POST /orders requests against a real PostgreSQL database for a product with exactly 2 units in stock. Use Promise.all to ensure the requests hit the server concurrently, verify that exactly 2 succeed and 8 fail with insufficient stock, and assert that the database available stock remains strictly non-negative."*

**Why it worked well:**
By explicitly specifying the concurrent trigger mechanism (`Promise.all`), target outcome constraints (2 successes, 8 clean failures), and the assertion against the live database rather than in-memory mocks, the AI generated a clean, repeatable test without hallucinating fake assertions.

---

## 3. One Specific Thing the AI Got Wrong and How It Was Noticed

### The Issue:
When first drafting the webhook signature verification, the AI initially attempted to compute the HMAC hash from the parsed JSON object (`JSON.stringify(req.body)`). 

### How It Was Noticed:
During manual verification with `curl` and the test runner, valid webhooks were intermittently rejected with `401 Invalid signature`. 

### The Root Cause & Fix:
`JSON.stringify(req.body)` re-serializes JavaScript objects without preserving the exact whitespace and property ordering of the sender's original raw HTTP body. To fix this, Express was configured with a custom `verify` callback on `express.json()`:
```ts
app.use(
  express.json({
    verify: (req: RequestWithRawBody, _res, buf) => {
      req.rawBody = buf; // Preserves exact byte buffer
    },
  })
);
```
The HMAC calculation was updated to hash `req.rawBody` directly, making signature verification 100% reliable and cryptographically sound.
