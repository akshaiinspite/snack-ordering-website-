/** Convert whole paise to a rupee display string. Display only — never used for calculation. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}₹${rupees}.${rem}`;
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const IMAGE_MAP: Record<string, string> = {
  "masala chips": "masala-chips.jpg",
  "crispy potato wafers": "masala-chips.jpg",
  "salted peanuts": "salted-peanuts.jpg",
  "roasted spiced peanuts": "salted-peanuts.jpg",
  "choco cookies": "choco-cookies.jpg",
  "chocolate cookies": "choco-cookies.jpg",
  "butter crunch cookies": "choco-cookies.jpg",
  "namkeen mix": "namkeen-mix.jpg",
  "chocolate bar": "chocolate-bar.jpg",
};

export function productImage(name: string): string | null {
  const file = IMAGE_MAP[name.trim().toLowerCase()];
  return file ? `/products/${file}` : null;
}
