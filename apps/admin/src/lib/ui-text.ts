import { translateLegacyText } from "@loyaltyos/i18n";

import i18n from "../i18n";

/** Translate a hard-coded UI literal while a screen is being migrated to catalog keys. */
export function ui(text: string): string {
  return translateLegacyText(text, i18n.language);
}

/**
 * System member fields are persisted with a stable English label. Translate
 * those known labels at render time so a locale-independent database value
 * does not leak Vietnamese into the English UI (or vice versa).
 */
export function memberFieldLabel(field: { key: string; label: string }): string {
  const systemLabels: Record<string, string> = {
    birth_date: "Birth date",
    work_anniversary_date: "Work anniversary date",
  };
  return ui(systemLabels[field.key] ?? field.label);
}
