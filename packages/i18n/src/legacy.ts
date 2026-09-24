import legacyVi from "./legacy-vi.json" with { type: "json" };

/**
 * Translate legacy UI literals that have not yet been migrated to a catalog key.
 * English remains the source text so the existing English UI is unchanged.
 */
export function translateLegacyText(text: string, locale: string): string {
  if (!locale.toLowerCase().startsWith("vi")) return text;
  return legacyVi[text as keyof typeof legacyVi] ?? text;
}
