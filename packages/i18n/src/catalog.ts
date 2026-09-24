import { createInstance } from "i18next";

import enUS from "./locales/en-US.json" with { type: "json" };
import viVN from "./locales/vi-VN.json" with { type: "json" };

const INTERNAL_I18N = createInstance();

let initialized = false;

export async function initCatalog(defaultLocale?: string): Promise<void> {
  const lng = defaultLocale ?? "vi-VN";

  if (!initialized) {
    await INTERNAL_I18N.init({
      lng,
      // English is the safe fallback for an incomplete locale catalog.
      fallbackLng: "en-US",
      resources: {
        "vi-VN": { translation: viVN },
        "en-US": { translation: enUS },
      },
      interpolation: {
        escapeValue: false,
        skipOnVariables: false,
      },
    });

    initialized = true;
  } else if (INTERNAL_I18N.language !== lng) {
    await INTERNAL_I18N.changeLanguage(lng);
  }
}

/**
 * Look up a translation key. Uses en-US as fallback chain.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  if (!initialized) {
    // Keep the synchronous path aligned with the neutral fallback language.
    return resolveFromJson(enUS, key, params);
  }
  return INTERNAL_I18N.t(key, { ...params, lng: INTERNAL_I18N.language });
}

export function changeLanguage(lng: string): Promise<void> {
  if (!initialized) return Promise.resolve();
  return INTERNAL_I18N.changeLanguage(lng).then(() => undefined);
}

export function getCurrentLanguage(): string {
  if (!initialized) return "vi-VN";
  return INTERNAL_I18N.language;
}

/**
 * Resolve a dot-notation key from a flat or nested JSON object.
 * Returns the key itself if not found.
 */
function resolveFromJson(
  obj: Record<string, unknown>,
  key: string,
  params?: Record<string, string | number>,
): string {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return key;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") return key;

  if (params) {
    return current.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? `{{${k}}}`));
  }
  return current;
}

export { enUS, viVN };
