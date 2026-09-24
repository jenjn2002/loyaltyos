import { translateLegacyText } from "@loyaltyos/i18n";

import i18n from "./i18n";

/** Translate a hard-coded UI literal while a screen is being migrated to catalog keys. */
export function ui(text: string): string {
  return translateLegacyText(text, i18n.language);
}
