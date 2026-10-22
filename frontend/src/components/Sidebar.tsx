import { CATEGORIES, getProductCategoryId } from "../lib/categories";
import type { Product } from "../lib/types";

interface Props {
  products: Product[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  inStockOnly: boolean;
  onToggleInStockOnly: (checked: boolean) => void;
  priceFilter: string; // 'all' | 'under40' | '40to60'
  onSelectPriceFilter: (filter: string) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}

export default function Sidebar({
  products,
  selectedCategory,
  onSelectCategory,
  inStockOnly,
  onToggleInStockOnly,
  priceFilter,
  onSelectPriceFilter,
  onResetFilters,
  hasActiveFilters,
}: Props) {
  // Compute counts for each category
  const counts: Record<string, number> = {
    all: products.length,
    chips: 0,
    peanuts: 0,
    cookies: 0,
    namkeen: 0,
    chocolates: 0,
  };

  products.forEach((p) => {
    const cat = getProductCategoryId(p.name);
    if (cat in counts) {
      counts[cat] = (counts[cat] || 0) + 1;
    }
  });

  return (
    <aside className="sidebar" aria-label="Store navigation and filters">
      {/* Category Section */}
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <h2 className="sidebar-title">Categories</h2>
          {hasActiveFilters && (
            <button className="link-btn small" onClick={onResetFilters} title="Reset all filters">
              Clear all
            </button>
          )}
        </div>
        <nav className="category-nav">
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.id;
            const count = counts[cat.id] ?? 0;
            return (
              <button
                key={cat.id}
                type="button"
                className={`category-item ${isActive ? "is-active" : ""}`}
                onClick={() => onSelectCategory(cat.id)}
              >
                <span className="category-icon" aria-hidden="true">{cat.icon}</span>
                <span className="category-name">{cat.name}</span>
                <span className="category-count">{count}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Filter Section */}
      <div className="sidebar-section">
        <h2 className="sidebar-title">Availability</h2>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => onToggleInStockOnly(e.target.checked)}
          />
          <span>In stock only</span>
        </label>
      </div>

      {/* Price Range Filter */}
      <div className="sidebar-section">
        <h2 className="sidebar-title">Price Range</h2>
        <div className="price-pills">
          <button
            type="button"
            className={`pill-btn ${priceFilter === "all" ? "is-active" : ""}`}
            onClick={() => onSelectPriceFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`pill-btn ${priceFilter === "under40" ? "is-active" : ""}`}
            onClick={() => onSelectPriceFilter("under40")}
          >
            Under ₹40
          </button>
          <button
            type="button"
            className={`pill-btn ${priceFilter === "40to60" ? "is-active" : ""}`}
            onClick={() => onSelectPriceFilter("40to60")}
          >
            ₹40 – ₹60
          </button>
        </div>
      </div>

      {/* Locker Pickup Feature Card */}
      <div className="sidebar-card">
        <div className="sidebar-card-badge">⚡ Pickup Station</div>
        <h3 className="sidebar-card-title">Locker Hub #04</h3>
        <p className="sidebar-card-desc">
          Automated smart locker counter. Pay online, receive secure OTP, and collect immediately.
        </p>
        <div className="sidebar-card-meta">
          <span>🟢 Open 24/7</span>
          <span>⏱️ ~2 min hold</span>
        </div>
      </div>
    </aside>
  );
}
