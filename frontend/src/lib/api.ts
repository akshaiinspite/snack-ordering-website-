import type { CartLine, CreatedOrder, OrderDetails, Product } from "./types";
import {
  SAMPLE_PRODUCTS,
  createDemoOrder,
  getDemoOrder,
  claimDemoOrder,
  updateDemoOrderStatus,
} from "./sampleData";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export let isPreviewMode = false;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Please check your connection and try again.");
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && ("error" in body || "message" in body)
        ? String((body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message)
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  getProducts: async (): Promise<Product[]> => {
    try {
      const prods = await request<Product[]>("/products");
      isPreviewMode = false;
      return prods;
    } catch (e) {
      // Backend not running yet: fallback to sample snacks for instant UI review
      console.warn("Backend unavailable, loading sample catalog for UI preview:", e);
      isPreviewMode = true;
      return SAMPLE_PRODUCTS;
    }
  },

  createOrder: async (items: CartLine[]): Promise<CreatedOrder> => {
    try {
      return await request<CreatedOrder>("/orders", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
    } catch (e) {
      if (isPreviewMode || (e instanceof ApiError && e.status === 0)) {
        return createDemoOrder(items);
      }
      throw e;
    }
  },

  getOrder: async (id: string): Promise<OrderDetails> => {
    try {
      return await request<OrderDetails>(`/orders/${encodeURIComponent(id)}`);
    } catch (e) {
      if (isPreviewMode || id.startsWith("demo_") || (e instanceof ApiError && e.status === 0)) {
        return getDemoOrder(id);
      }
      throw e;
    }
  },

  claimPickup: async (id: string): Promise<{ status?: string }> => {
    try {
      return await request<{ status?: string }>(`/orders/${encodeURIComponent(id)}/pickup-claim`, {
        method: "POST",
      });
    } catch (e) {
      if (isPreviewMode || id.startsWith("demo_") || (e instanceof ApiError && e.status === 0)) {
        return claimDemoOrder(id);
      }
      throw e;
    }
  },

  simulateDemoStatus: async (id: string, status: OrderDetails["status"]) => {
    updateDemoOrderStatus(id, status);
    if (!id.startsWith("demo_") && !isPreviewMode) {
      try {
        await request(`/orders/${encodeURIComponent(id)}/status`, {
          method: "POST",
          body: JSON.stringify({ status }),
        });
      } catch (err) {
        console.warn("Could not sync simulated status with server:", err);
      }
    }
  },
};

