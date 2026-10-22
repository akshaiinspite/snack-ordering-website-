import { formatPaise } from "../lib/format";

interface Props {
  onHome?: () => void;
  cartCount?: number;
  cartTotalPaise?: number;
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  onCartClick?: () => void;
}

export default function Header({
  onHome,
  cartCount = 0,
  cartTotalPaise = 0,
  searchQuery = "",
  onSearchChange,
  onCartClick,
}: Props) {
  return (
    <header className="header">
      <div className="container header-inner">
        {/* Brand */}
        <div className="brand" onClick={onHome} style={{ cursor: onHome ? "pointer" : "default" }}>
          <div className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <div>
            <h1 className="brand-name">SnackCounter</h1>
            <p className="brand-tag">Express Locker Store</p>
          </div>
        </div>

        {/* E-commerce Search Bar */}
        {onSearchChange && (
          <div className="header-search" role="search">
            <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search snacks, cookies, chips..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search snacks"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Header Actions */}
        <div className="header-actions">

          {onHome ? (
            <button id="header-new-order" className="btn btn-ghost header-back-btn" onClick={onHome}>
              ← Back to snacks
            </button>
          ) : (
            <button
              id="header-cart-btn"
              className={`header-cart-btn ${cartCount > 0 ? "has-items" : ""}`}
              onClick={onCartClick}
              aria-label={`Cart with ${cartCount} items totaling ${formatPaise(cartTotalPaise)}`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <span className="cart-badge">{cartCount}</span>
              <span className="cart-amount">{cartCount > 0 ? formatPaise(cartTotalPaise) : "Cart"}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
