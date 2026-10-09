import type { GuideArticle } from "./document-types";

// Real sandbox screenshots, with personal values redacted, travel with the app.
// CMS uploads take precedence; a null imageKey explicitly opts out of the fallback.
export const adminScreenshotSlugs = new Set([
  "dashboard", "roles-permissions", "members", "member-fields", "member-import",
  "point-types", "wallet-adjustments", "issuance-rules", "banks-cycles", "ledger",
  "segments", "recognition-categories", "tiers-badges", "events", "campaigns",
  "workflows-approvals", "approval-inbox", "projects", "rewards", "coupons",
  "exchange", "logs", "data-export", "notification-templates", "settings",
]);

export function guideScreenshot(article: Pick<GuideArticle, "audience" | "slug" | "imageKey" | "imageData">): string | null {
  if (article.imageData) return article.imageData;
  if (article.audience !== "ADMIN" || article.imageKey === null || !adminScreenshotSlugs.has(article.slug)) return null;
  return `${import.meta.env.BASE_URL}documentation/admin-${article.slug}.jpg`;
}
