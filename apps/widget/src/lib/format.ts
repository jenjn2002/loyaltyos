export function formatPoints(n: number, locale = "vi-VN"): string {
  return n.toLocaleString(locale === "vi-VN" ? "vi-VN" : "en-US");
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
