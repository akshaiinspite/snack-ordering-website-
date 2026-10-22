import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, isPreviewMode } from "../lib/api";
import type { CreatedOrder, Product } from "../lib/types";
import { CATEGORIES, getProductCategoryId } from "../lib/categories";
import ProductCard from "../components/ProductCard";
import CartPanel from "../components/CartPanel";
import Sidebar from "../components/Sidebar";

interface Props {
  onOrderCreated: (order: CreatedOrder) => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  onCartSummaryChange?: (summary: { count: number; totalPaise: number }) => void;
}

export default function ProductsPage({
  onOrderCreated,
  searchQuery = "",
  onClearSearch,
  onCartSummaryChange,
}: Props) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Sidebar filter states
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("featured");

  const load = useCallback(async () => {
    try {
      const items = await api.getProducts();
      setProducts(items);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load products");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setCheckoutError(null);
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });
  }, []);

  // Money is handled strictly as integer paise; converted to rupees only for display.
  const totalPaise = useMemo(
    () => (products ?? []).reduce((sum, p) => sum + (cart[p.id] ?? 0) * p.pricePaise, 0),
    [products, cart],
  );

  const totalCount = useMemo(
    () => Object.values(cart).reduce((sum, q) => sum + q, 0),
    [cart],
  );

  useEffect(() => {
    onCartSummaryChange?.({ count: totalCount, totalPaise });
  }, [totalCount, totalPaise, onCartSummaryChange]);

  const overLimit = useMemo(
    () => (products ?? []).filter((p) => (cart[p.id] ?? 0) > p.availableStock).map((p) => p.id),
    [products, cart],
  );

  const resetAllFilters = useCallback(() => {
    setSelectedCategory("all");
    setInStockOnly(false);
    setPriceFilter("all");
    setSortBy("featured");
    onClearSearch?.();
  }, [onClearSearch]);

  const hasActiveFilters = useMemo(
    () =>
      selectedCategory !== "all" ||
      inStockOnly ||
      priceFilter !== "all" ||
      searchQuery.trim().length > 0,
    [selectedCategory, inStockOnly, priceFilter, searchQuery],
  );

  // Filtered and sorted products
  const filteredProducts = useMemo(() => {
    if (!products) return [];

    let result = products.filter((p) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!p.name.toLowerCase().includes(q)) return false;
      }

      // Category filter
      if (selectedCategory !== "all") {
        const cat = getProductCategoryId(p.name);
        if (cat !== selectedCategory) return false;
      }

      // Stock filter
      if (inStockOnly && p.availableStock <= 0) {
        return false;
      }

      // Price filter (paise: 4000 = ₹40, 6000 = ₹60)
      if (priceFilter === "under40" && p.pricePaise > 4000) {
        return false;
      }
      if (priceFilter === "40to60" && (p.pricePaise < 4000 || p.pricePaise > 6000)) {
        return false;
      }

      return true;
    });

    // Sorting
    if (sortBy === "price-asc") {
      result = [...result].sort((a, b) => a.pricePaise - b.pricePaise);
    } else if (sortBy === "price-desc") {
      result = [...result].sort((a, b) => b.pricePaise - a.pricePaise);
    } else if (sortBy === "name-asc") {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  }, [products, searchQuery, selectedCategory, inStockOnly, priceFilter, sortBy]);

  const currentCategoryName = useMemo(() => {
    const found = CATEGORIES.find((c) => c.id === selectedCategory);
    return found ? found.name : "All Snacks";
  }, [selectedCategory]);

  const checkout = async () => {
    setSubmitting(true);
    setCheckoutError(null);
    try {
      const items = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
      const order = await api.createOrder(items);
      onOrderCreated(order);
    } catch (e) {
      setCheckoutError(e instanceof ApiError ? e.message : "Could not create the order.");
      await load(); // stock may have changed — refresh availability
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {isPreviewMode && (
        <div className="preview-banner" role="status">
          <span className="preview-badge">UI Preview Mode</span>
          <span>
            Displaying sample snacks & stock for design evaluation. (Backend will provide live PostgreSQL data once started).
          </span>
        </div>
      )}

      {/* Hero Banner */}
      <section className="hero">
        <div className="hero-content">
          <span className="hero-badge">⚡ Instant 2-Min Dispense</span>
          <h2 className="hero-title">Fresh snacks, ready at your smart locker</h2>
          <p className="hero-sub">
            Order your favorite snacks, pay securely online, and collect instantly from Locker Station Hub #04.
          </p>
        </div>
      </section>

      {/* Ecommerce 3-column Layout */}
      <div className="ecommerce-layout">
        {/* Left Column: Sidebar */}
        <div className="layout-sidebar">
          {products ? (
            <Sidebar
              products={products}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              inStockOnly={inStockOnly}
              onToggleInStockOnly={setInStockOnly}
              priceFilter={priceFilter}
              onSelectPriceFilter={setPriceFilter}
              onResetFilters={resetAllFilters}
              hasActiveFilters={hasActiveFilters}
            />
          ) : (
            <div className="card skeleton" style={{ height: "380px" }} />
          )}
        </div>

        {/* Center Column: Products Catalog */}
        <section className="layout-catalog" aria-label="Products Catalog">
          {/* Catalog Top Header Bar */}
          <div className="catalog-header">
            <div>
              <h2 className="catalog-title">
                {currentCategoryName}{" "}
                {products && <span className="catalog-count">({filteredProducts.length} items)</span>}
              </h2>
              <p className="catalog-subtitle">
                {searchQuery ? `Matching results for "${searchQuery}"` : "Reserve now to lock in available locker stock"}
              </p>
            </div>

            <div className="catalog-actions">
              <label htmlFor="sort-select" className="sort-label">Sort:</label>
              <select
                id="sort-select"
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name-asc">Name: A to Z</option>
              </select>
            </div>
          </div>

          {loadError && !products && (
            <div className="alert alert-error" role="alert">
              {loadError}{" "}
              <button className="link-btn" onClick={() => void load()}>Retry</button>
            </div>
          )}

          {!products && !loadError && (
            <div className="grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card skeleton" />
              ))}
            </div>
          )}

          {products && filteredProducts.length === 0 && (
            <div className="card empty-products">
              <div className="empty-icon" aria-hidden="true">🍿</div>
              <h3 className="empty-title">No snacks found</h3>
              <p className="muted empty-desc">
                We couldn&apos;t find any items matching your selected filters or search.
              </p>
              <button className="btn btn-primary" onClick={resetAllFilters}>
                Clear all filters
              </button>
            </div>
          )}

          {products && filteredProducts.length > 0 && (
            <div className="grid">
              {filteredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  quantity={cart[p.id] ?? 0}
                  onChange={setQuantity}
                />
              ))}
            </div>
          )}
        </section>

        {/* Right Column: Sticky Cart Panel */}
        <div className="layout-cart">
          {products && (
            <CartPanel
              products={products}
              cart={cart}
              totalPaise={totalPaise}
              overLimit={overLimit}
              submitting={submitting}
              onChange={setQuantity}
              onCheckout={checkout}
            />
          )}
          {checkoutError && (
            <div className="alert alert-error" role="alert" id="checkout-error">
              {checkoutError}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
