export interface CategoryDef {
  id: string;
  name: string;
  icon: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "all", name: "All Snacks", icon: "🍿" },
  { id: "chips", name: "Chips & Crisps", icon: "🥔" },
  { id: "peanuts", name: "Nuts & Peanuts", icon: "🥜" },
  { id: "cookies", name: "Cookies & Bakery", icon: "🍪" },
  { id: "namkeen", name: "Namkeen & Savory", icon: "🥨" },
  { id: "chocolates", name: "Chocolates", icon: "🍫" },
];

export function getProductCategoryId(productName: string): string {
  const lower = productName.toLowerCase();
  if (lower.includes("chip") || lower.includes("wafer")) return "chips";
  if (lower.includes("peanut") || lower.includes("nut")) return "peanuts";
  if (lower.includes("cookie") || lower.includes("biscuit")) return "cookies";
  if (lower.includes("namkeen") || lower.includes("mix")) return "namkeen";
  if (lower.includes("choco") || lower.includes("bar")) return "chocolates";
  return "all";
}
