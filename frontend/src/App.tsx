import { useCallback, useState } from "react";
import Header from "./components/Header";
import ProductsPage from "./pages/ProductsPage";
import OrderPage from "./pages/OrderPage";
import type { CreatedOrder } from "./lib/types";

const STORAGE_KEY = "pickup-counter:orderId";

export default function App() {
  const [orderId, setOrderId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [initial, setInitial] = useState<CreatedOrder | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [cartSummary, setCartSummary] = useState({ count: 0, totalPaise: 0 });

  const openOrder = useCallback((order: CreatedOrder) => {
    localStorage.setItem(STORAGE_KEY, order.orderId);
    setInitial(order);
    setOrderId(order.orderId);
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setInitial(null);
    setOrderId(null);
  }, []);

  const handleCartClick = useCallback(() => {
    const el = document.getElementById("cart-panel");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return (
    <div className="app">
      <Header
        onHome={orderId ? reset : undefined}
        cartCount={cartSummary.count}
        cartTotalPaise={cartSummary.totalPaise}
        searchQuery={orderId ? undefined : searchQuery}
        onSearchChange={orderId ? undefined : setSearchQuery}
        onCartClick={handleCartClick}
      />
      <main className="container">
        {orderId ? (
          <OrderPage orderId={orderId} initial={initial} onNewOrder={reset} />
        ) : (
          <ProductsPage
            onOrderCreated={openOrder}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery("")}
            onCartSummaryChange={setCartSummary}
          />
        )}
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <p>SnackCounter Express · Smart Automated Locker Pickups</p>
          <p className="footer-sub">Payments are simulated in this preview environment</p>
        </div>
      </footer>
    </div>
  );
}
