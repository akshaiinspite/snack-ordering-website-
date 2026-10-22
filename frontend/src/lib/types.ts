export type OrderStatus = "pending" | "paid" | "expired" | "needs_review";

export interface Product {
  id: string;
  name: string;
  /** Price in whole paise (never floating-point rupees). */
  pricePaise: number;
  /** Physical stock minus stock reserved by unpaid orders. */
  availableStock: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface CreatedOrder {
  orderId: string;
  totalAmountPaise: number;
  status: OrderStatus;
  expiresInSeconds: number;
}

export interface OrderItem {
  productId: string;
  name?: string;
  quantity: number;
  unitPricePaise?: number;
}

export interface OrderDetails {
  id: string;
  status: OrderStatus;
  totalAmountPaise: number;
  /** Remaining hold time, calculated by the server/database clock. */
  expiresInSeconds: number | null;
  claimed?: boolean;
  items?: OrderItem[];
}
