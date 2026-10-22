export type OrderStatus = "pending" | "paid" | "expired" | "needs_review";

export interface Product {
  id: string;
  name: string;
  pricePaise: number;
  availableStock: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
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
  expiresInSeconds: number | null;
  claimed: boolean;
  items?: OrderItem[];
}

export interface WebhookPayload {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: "captured" | string;
}
