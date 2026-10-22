import type { CreatedOrder, OrderDetails, Product } from "./types";

export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: "prod_chips",
    name: "Masala Chips",
    pricePaise: 4000, // ₹40.00
    availableStock: 14,
  },
  {
    id: "prod_peanuts",
    name: "Salted Peanuts",
    pricePaise: 2500, // ₹25.00
    availableStock: 8,
  },
  {
    id: "prod_cookies",
    name: "Choco Cookies",
    pricePaise: 5000, // ₹50.00
    availableStock: 3, // Shows "Only 3 left"
  },
  {
    id: "prod_namkeen",
    name: "Namkeen Mix",
    pricePaise: 3500, // ₹35.00
    availableStock: 18,
  },
  {
    id: "prod_chocobar",
    name: "Chocolate Bar",
    pricePaise: 6000, // ₹60.00
    availableStock: 0, // Shows "Sold out"
  },
];

let demoOrders: Record<string, OrderDetails> = {};

export function createDemoOrder(items: { productId: string; quantity: number }[]): CreatedOrder {
  const totalAmountPaise = items.reduce((sum, item) => {
    const prod = SAMPLE_PRODUCTS.find((p) => p.id === item.productId);
    return sum + (prod ? prod.pricePaise * item.quantity : 0);
  }, 0);

  const orderId = `demo_ord_${Math.random().toString(36).substring(2, 8)}`;
  const order: OrderDetails = {
    id: orderId,
    status: "pending",
    totalAmountPaise,
    expiresInSeconds: 120,
    claimed: false,
    items: items.map((it) => {
      const p = SAMPLE_PRODUCTS.find((prod) => prod.id === it.productId);
      return {
        productId: it.productId,
        name: p?.name ?? it.productId,
        quantity: it.quantity,
        unitPricePaise: p?.pricePaise ?? 0,
      };
    }),
  };

  demoOrders[orderId] = order;

  return {
    orderId,
    totalAmountPaise,
    status: "pending",
    expiresInSeconds: 120,
  };
}

export function getDemoOrder(orderId: string): OrderDetails {
  if (demoOrders[orderId]) {
    return { ...demoOrders[orderId] };
  }
  // Fallback demo order if visited directly
  return {
    id: orderId,
    status: "pending",
    totalAmountPaise: 9000,
    expiresInSeconds: 110,
    claimed: false,
    items: [
      { productId: "prod_chips", name: "Masala Chips", quantity: 1, unitPricePaise: 4000 },
      { productId: "prod_cookies", name: "Choco Cookies", quantity: 1, unitPricePaise: 5000 },
    ],
  };
}

export function updateDemoOrderStatus(orderId: string, status: OrderDetails["status"]) {
  if (!demoOrders[orderId]) {
    demoOrders[orderId] = getDemoOrder(orderId);
  }
  demoOrders[orderId].status = status;
  if (status !== "pending") {
    demoOrders[orderId].expiresInSeconds = null;
  }
}

export function claimDemoOrder(orderId: string) {
  if (!demoOrders[orderId]) {
    demoOrders[orderId] = getDemoOrder(orderId);
  }
  if (demoOrders[orderId].claimed) {
    const err = new Error("Order already claimed");
    (err as unknown as { status: number }).status = 409;
    throw err;
  }
  demoOrders[orderId].claimed = true;
  return { status: "claimed" };
}
