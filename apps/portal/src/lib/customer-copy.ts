import { useTranslation } from "react-i18next";

/** Feature-local bilingual copy while legacy screens move to catalog keys. */
export function useCustomerCopy() {
  const { i18n } = useTranslation();
  return (english: string, vietnamese: string): string =>
    i18n.language.startsWith("vi") ? vietnamese : english;
}
