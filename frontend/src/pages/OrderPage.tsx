import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, isPreviewMode } from "../lib/api";
import { formatCountdown, formatPaise } from "../lib/format";
import type { CreatedOrder, OrderDetails, OrderStatus } from "../lib/types";

interface Props {
  orderId: string;
  initial: CreatedOrder | null;
  onNewOrder: () => void;
}

const POLL_MS = 3000;
const TERMINAL: OrderStatus[] = ["paid", "expired", "needs_review"];

const STATUS_COPY: Record<OrderStatus, { title: string; body: string; tone: "info" | "success" | "danger" | "warn" }> = {
  pending: {
    title: "Awaiting payment",
    body: "Your items are reserved. Complete the (simulated) payment before the timer runs out.",
    tone: "info",
  },
  paid: {
    title: "Payment received",
    body: "Thank you! Your order is paid. Head to the locker and claim your pickup.",
    tone: "success",
  },
  expired: {
    title: "Reservation expired",
    body: "The 2-minute hold ended before payment was confirmed, so the items were released. Please place a new order.",
    tone: "danger",
  },
  needs_review: {
    title: "Needs review",
    body: "We received a payment that doesn't match the order total, so it has been flagged for manual review. Please contact the counter staff with your order ID.",
    tone: "warn",
  },
};

export default function OrderPage({ orderId, initial, onNewOrder }: Props) {
  const [order, setOrder] = useState<OrderDetails | null>(
    initial
      ? {
          id: initial.orderId,
          status: initial.status,
          totalAmountPaise: initial.totalAmountPaise,
          expiresInSeconds: initial.expiresInSeconds,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(initial?.expiresInSeconds ?? null);
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Countdown anchor: server-provided remaining seconds + a monotonic local timer
  // (performance.now) so that changes to the device's wall clock cannot affect it.
  const anchor = useRef<{ seconds: number; at: number } | null>(
    initial ? { seconds: initial.expiresInSeconds, at: performance.now() } : null,
  );

  const sync = useCallback((o: OrderDetails) => {
    setOrder(o);
    if (o.status === "pending" && typeof o.expiresInSeconds === "number") {
      anchor.current = { seconds: o.expiresInSeconds, at: performance.now() };
      setRemaining(o.expiresInSeconds);
    } else {
      anchor.current = null;
      setRemaining(null);
    }
  }, []);

  const status = order?.status ?? "pending";
  const isTerminal = order ? TERMINAL.includes(order.status) : false;

  // Poll the server until a terminal status is reached.
  useEffect(() => {
    if (isTerminal || notFound) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const o = await api.getOrder(orderId);
        if (cancelled) return;
        setError(null);
        sync(o);
        if (TERMINAL.includes(o.status)) return; // stop polling
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
          return;
        }
        setError(e instanceof Error ? e.message : "Unable to refresh order status.");
      }
      timer = setTimeout(tick, POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, isTerminal, notFound, sync]);

  // Smooth countdown tick between polls.
  useEffect(() => {
    if (status !== "pending") return;
    const id = setInterval(() => {
      const a = anchor.current;
      if (!a) return;
      const elapsed = (performance.now() - a.at) / 1000;
      setRemaining(Math.max(0, a.seconds - elapsed));
    }, 250);
    return () => clearInterval(id);
  }, [status]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(orderId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const claim = async () => {
    setClaiming(true);
    setClaimMsg(null);
    try {
      await api.claimPickup(orderId);
      setClaimMsg({ ok: true, text: "Pickup claimed — the locker door has unlocked! Enjoy your snacks." });
      setOrder((o) => (o ? { ...o, claimed: true } : o));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setClaimMsg({ ok: false, text: "This order cannot be claimed (it may already have been collected)." });
        setOrder((o) => (o ? { ...o, claimed: true } : o));
      } else {
        setClaimMsg({ ok: false, text: e instanceof Error ? e.message : "Pickup claim failed." });
      }
    } finally {
      setClaiming(false);
    }
  };

  const handleSimulateStatus = (nextStatus: OrderStatus) => {
    api.simulateDemoStatus(orderId, nextStatus);
    const updated = {
      ...(order ?? {
        id: orderId,
        status: nextStatus,
        totalAmountPaise: 9000,
        expiresInSeconds: null,
      }),
      status: nextStatus,
      expiresInSeconds: nextStatus === "pending" ? 115 : null,
      claimed: nextStatus === "paid" ? false : order?.claimed,
    };
    sync(updated);
    setClaimMsg(null);
  };

  if (notFound) {
    return (
      <div className="card center-card">
        <h2>Order not found</h2>
        <p className="muted">We couldn't find order <code>{orderId}</code>.</p>
        <button className="btn btn-primary" onClick={onNewOrder}>Start a new order</button>
      </div>
    );
  }

  const copy = STATUS_COPY[status];
  const lowTime = remaining !== null && remaining <= 20;
  const timeUp = status === "pending" && remaining !== null && remaining <= 0;
  const isDemo = isPreviewMode || orderId.startsWith("demo_");

  return (
    <div className="order-wrap">
      {isDemo && (
        <div className="preview-banner" role="status">
          <span className="preview-badge">UI Preview Mode</span>
          <span>
            You are inspecting the Order & Locker screen. Use the simulation buttons below to test all statuses.
          </span>
        </div>
      )}

      <section className={`card status status-${copy.tone}`} aria-live="polite" id="order-status-card">
        <div className="status-head">
          <span className={`status-dot dot-${copy.tone}`} aria-hidden="true" />
          <div>
            <p className="eyebrow">Order status</p>
            <h2 className="status-title" id="order-status-title">{copy.title}</h2>
          </div>
          <span className={`badge badge-${status}`} id="order-status-badge">{status.replace("_", " ")}</span>
        </div>
        <p className="status-body">{timeUp ? "Time is up — confirming with the server…" : copy.body}</p>

        {status === "pending" && (
          <div className={`countdown ${lowTime ? "is-low" : ""}`} role="timer" id="countdown">
            <span className="countdown-label">Time left to pay</span>
            <span className="countdown-time">{remaining === null ? "--:--" : formatCountdown(remaining)}</span>
            <span className="muted small">Based on the server's clock, not your device.</span>
          </div>
        )}

        {status === "paid" && (
          <div className="claim">
            <button
              id="claim-btn"
              className="btn btn-primary btn-lg"
              onClick={claim}
              disabled={claiming || order?.claimed === true}
            >
              {order?.claimed ? "Already Claimed ✓" : claiming ? "Unlocking locker…" : "Unlock Locker & Claim Pickup"}
            </button>
            {claimMsg && (
              <p className={claimMsg.ok ? "success small" : "error small"} role="status">{claimMsg.text}</p>
            )}
          </div>
        )}

        {(status === "expired" || status === "needs_review") && (
          <button id="new-order-btn" className="btn btn-primary" onClick={onNewOrder}>
            Place a new order
          </button>
        )}
        {status === "paid" && order?.claimed && (
          <button className="btn btn-ghost" onClick={onNewOrder}>Place another order</button>
        )}

        {error && <p className="error small" role="alert">Connection issue: {error} Retrying…</p>}
      </section>

      <section className="card summary" aria-label="Order summary">
        <h3 className="summary-title">Order summary</h3>
        <dl className="kv">
          <div>
            <dt>Order ID</dt>
            <dd className="mono-row">
              <code id="order-id">{orderId}</code>
              <button className="link-btn" id="copy-order-id" onClick={copyId}>{copied ? "Copied ✓" : "Copy"}</button>
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd><strong id="order-total">{order ? formatPaise(order.totalAmountPaise) : "—"}</strong></dd>
          </div>
        </dl>

        {order?.items && order.items.length > 0 && (
          <ul className="summary-items">
            {order.items.map((it) => (
              <li key={it.productId}>
                <span>{it.name ?? it.productId}</span>
                <span className="muted">× {it.quantity}</span>
              </li>
            ))}
          </ul>
        )}

        {!isTerminal && (
          <p className="muted small polling">
            <span className="spinner" aria-hidden="true" /> Checking payment status every {POLL_MS / 1000}s…
          </p>
        )}
      </section>

      <section className="card simulate" aria-label="Simulate payment" id="simulate-payment">
        <h3 className="summary-title">Simulate Payment Webhook</h3>
        <p className="muted">
          In production, payment captures arrive via signed webhook from your gateway.
        </p>

        <div className="demo-controls">
          <p className="small" style={{ fontWeight: 600, color: "var(--ink)" }}>
            Quick Status Simulator (Test locker states in real-time):
          </p>
          <div className="demo-buttons">
            <button
              className={`btn btn-sm ${status === "paid" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => handleSimulateStatus("paid")}
            >
              ✓ Mark Paid (Enable Locker)
            </button>
            <button
              className={`btn btn-sm ${status === "needs_review" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => handleSimulateStatus("needs_review")}
            >
              ⚠️ Mismatched Amount (Needs Review)
            </button>
            <button
              className={`btn btn-sm ${status === "expired" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => handleSimulateStatus("expired")}
            >
              ⏳ Expire Reservation
            </button>
            <button
              className={`btn btn-sm ${status === "pending" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => handleSimulateStatus("pending")}
            >
              🔄 Reset to Pending
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
