import enUS from "@loyaltyos/i18n/src/locales/en-US.json" with { type: "json" };
import viVN from "@loyaltyos/i18n/src/locales/vi-VN.json" with { type: "json" };
import type { i18n as I18nInstance } from "i18next";
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

const LOCALE_STORAGE_KEY = "loyaltyos:locale";

export function getStoredLocale(): string {
  return localStorage.getItem(LOCALE_STORAGE_KEY) ?? "vi-VN";
}

export function persistLocale(locale: string): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
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
      caches: ["localStorage"],
    },
  });

export default i18n;
