import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(import.meta.dirname, "..", "src", "locales");
const TYPES_PATH = join(import.meta.dirname, "..", "src", "types.ts");

interface NestedJson {
  [key: string]: string | NestedJson;
}

function getAllKeys(obj: NestedJson, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      keys.push(fullKey);
    } else {
      keys.push(...getAllKeys(value, fullKey));
    }
  }
  return keys;
}

function main(): void {
  const viVnPath = join(LOCALES_DIR, "vi-VN.json");
  const viVn = JSON.parse(readFileSync(viVnPath, "utf-8")) as NestedJson;

  const content = `import viVN from "./locales/vi-VN.json" with { type: "json" };

type JsonShape = typeof viVN;

type DotPrefix<T extends string, K extends string> = K extends ""
  ? T
  : \`\${T}.\${K}\`;

type NestedKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? NestedKeys<T[K], DotPrefix<Prefix, K>>
    : DotPrefix<Prefix, K>;
}[keyof T & string];

/** All valid translation keys derived from vi-VN.json */
export type TranslationKey = NestedKeys<JsonShape>;

/** Type-safe t() function signature */
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;
`;

  writeFileSync(TYPES_PATH, content, "utf-8");
  console.log(`✅ Generated types with ${String(getAllKeys(viVn).length)} keys`);
}

main();
