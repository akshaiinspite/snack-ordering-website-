import type { Product } from "../lib/types";
import { formatPaise, productImage } from "../lib/format";

interface Props {
  product: Product;
  quantity: number;
  onChange: (productId: string, quantity: number) => void;
}

export default function ProductCard({ product, quantity, onChange }: Props) {
  const img = productImage(product.name);
  const soldOut = product.availableStock <= 0;
  const atMax = quantity >= product.availableStock;

  return (
    <article className={`card product ${soldOut ? "is-soldout" : ""}`} id={`product-${product.id}`}>
      <div className="product-media">
        {img ? (
          <img src={img} alt={product.name} loading="lazy" />
        ) : (
          <div className="product-fallback" aria-hidden="true">{product.name.charAt(0)}</div>
        )}
        <span className={`stock-badge ${soldOut ? "out" : product.availableStock <= 3 ? "low" : ""}`}>
          {soldOut ? "Sold out" : product.availableStock <= 3 ? `Only ${product.availableStock} left` : `${product.availableStock} available`}
        </span>
      </div>
      <div className="product-body">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-price">{formatPaise(product.pricePaise)}</p>

        {quantity === 0 ? (
          <button
            id={`add-${product.id}`}
            className="btn btn-primary btn-block"
            disabled={soldOut}
            onClick={() => onChange(product.id, 1)}
          >
            {soldOut ? "Unavailable" : "Add to cart"}
          </button>
        ) : (
          <div className="stepper" role="group" aria-label={`Quantity of ${product.name}`}>
            <button
              id={`dec-${product.id}`}
              className="stepper-btn"
              aria-label={`Decrease ${product.name}`}
              onClick={() => onChange(product.id, quantity - 1)}
            >
              −
            </button>
            <span className="stepper-value" aria-live="polite">{quantity}</span>
            <button
              id={`inc-${product.id}`}
              className="stepper-btn"
              aria-label={`Increase ${product.name}`}
              disabled={atMax}
              onClick={() => onChange(product.id, quantity + 1)}
            >
              +
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
