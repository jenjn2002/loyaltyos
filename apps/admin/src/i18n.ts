import enUS from "@loyaltyos/i18n/src/locales/en-US.json" with { type: "json" };
import viVN from "@loyaltyos/i18n/src/locales/vi-VN.json" with { type: "json" };
import type { i18n as I18nInstance } from "i18next";
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

const LOCALE_STORAGE_KEY = "loyaltyos:locale";
const ADMIN_LOCALE_PREFERENCES_KEY = "loyaltyos:admin-locale-preferences";

export type AdminLocale = "vi-VN" | "en-US";
export interface AdminLocalePreference {
  locale: AdminLocale;
  source: "explicit" | "profile";
}

function isAdminLocale(value: unknown): value is AdminLocale {
  return value === "vi-VN" || value === "en-US";
}

function readAdminLocalePreferences(): Record<string, AdminLocalePreference> {
  try {
    const stored = localStorage.getItem(ADMIN_LOCALE_PREFERENCES_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([adminId, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const preference = value as Partial<AdminLocalePreference>;
      return isAdminLocale(preference.locale) && (preference.source === "explicit" || preference.source === "profile")
        ? [[adminId, { locale: preference.locale, source: preference.source }]]
        : [];
    }));
  } catch {
    return {};
  }
}

export function getStoredLocale(): string {
  return localStorage.getItem(LOCALE_STORAGE_KEY) ?? "vi-VN";
}

export function persistLocale(locale: AdminLocale, adminId?: string, source: AdminLocalePreference["source"] = "explicit"): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  if (!adminId) return;
  const preferences = readAdminLocalePreferences();
  preferences[adminId] = { locale, source };
  localStorage.setItem(ADMIN_LOCALE_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function getAdminLocalePreference(adminId: string): AdminLocalePreference | null {
  return readAdminLocalePreferences()[adminId] ?? null;
}

export function hasAdminLocalePreferences(): boolean {
  return Object.keys(readAdminLocalePreferences()).length > 0;
}

export function getLegacyExplicitLocale(): AdminLocale | null {
  const locale = localStorage.getItem(LOCALE_STORAGE_KEY);
  // Older builds let i18next cache the default locale into this same key, so
  // a cached vi-VN value is indistinguishable from the untouched default. The
  // old selector's non-default English choice is the only safe migration hint.
  return !hasAdminLocalePreferences() && locale === "en-US" ? locale : null;
}

export function persistProfileLocale(locale: AdminLocale, adminId: string): void {
  persistLocale(locale, adminId, "profile");
}

const i18n: I18nInstance = createInstance();

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: getStoredLocale(),
    // Missing English keys must never fall back to Vietnamese in the English UI.
    fallbackLng: "en-US",
    supportedLngs: ["vi-VN", "en-US"],
    resources: {
      "vi-VN": { translation: viVN },
      "en-US": { translation: enUS },
    },
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      // Locale persistence is explicit and admin-scoped above; do not let the
      // browser detector create a false explicit preference before auth loads.
      caches: [],
    },
  });

export default i18n;
