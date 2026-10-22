import type { Product } from "../lib/types";
import { formatPaise } from "../lib/format";

interface Props {
  products: Product[];
  cart: Record<string, number>;
  totalPaise: number;
  overLimit: string[];
  submitting: boolean;
  onChange: (productId: string, quantity: number) => void;
  onCheckout: () => void;
}

export default function CartPanel({ products, cart, totalPaise, overLimit, submitting, onChange, onCheckout }: Props) {
  const lines = products.filter((p) => (cart[p.id] ?? 0) > 0);
  const count = lines.reduce((n, p) => n + cart[p.id], 0);
  const disabled = lines.length === 0 || overLimit.length > 0 || submitting;

  return (
    <aside className="card cart" aria-label="Your cart" id="cart-panel">
      <h2 className="cart-title">
        Your cart {count > 0 && <span className="pill">{count}</span>}
      </h2>

      {lines.length === 0 ? (
        <p className="muted cart-empty">Your cart is empty. Add some snacks to get started.</p>
      ) : (
        <ul className="cart-lines">
          {lines.map((p) => {
            const q = cart[p.id];
            const over = q > p.availableStock;
            return (
              <li key={p.id} className="cart-line">
                <div className="cart-line-info">
                  <span className="cart-line-name">{p.name}</span>
                  <span className="muted small">{q} × {formatPaise(p.pricePaise)}</span>
                  {over && <span className="error small">Only {p.availableStock} available</span>}
                </div>
                <div className="cart-line-right">
                  <span className="cart-line-total">{formatPaise(q * p.pricePaise)}</span>
                  <button
                    className="link-btn"
                    id={`remove-${p.id}`}
                    onClick={() => onChange(p.id, 0)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="cart-total">
        <span>Total</span>
        <strong id="cart-total">{formatPaise(totalPaise)}</strong>
      </div>

      <button id="checkout-btn" className="btn btn-primary btn-block btn-lg" disabled={disabled} onClick={onCheckout}>
        {submitting ? "Reserving…" : "Checkout & reserve"}
      </button>
      <p className="muted small center">Stock is held for 2 minutes after checkout.</p>
    </aside>
  );
}
