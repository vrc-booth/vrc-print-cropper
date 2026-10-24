import { en } from "./locales/en";
import { ja } from "./locales/ja";
import { ko, type Dict } from "./locales/ko";
import { zhHans } from "./locales/zh-Hans";
import { zhHant } from "./locales/zh-Hant";

const DICTIONARIES = { ko, en, ja, "zh-Hans": zhHans, "zh-Hant": zhHant } satisfies Record<string, Dict>;

export type Locale = keyof typeof DICTIONARIES;
export type MessageKey = keyof Dict;
/** The picker is built from this, labeled by each dictionary's languageName. */
export const LOCALES = Object.keys(DICTIONARIES) as Locale[];

const STORAGE_KEY = "vrc-print-cropper.locale";

/** The UI language. Anything reading it through `t` re-renders when it changes. */
export const i18n = $state({ locale: "en" as Locale });

function isLocale(value: string | null): value is Locale {
  return value !== null && Object.hasOwn(DICTIONARIES, value);
}

/**
 * A valid `stored` value wins. Otherwise the first entry of `languages` that maps, by BCP 47 subtags:
 *   zh-Hant*, zh-TW, zh-HK, zh-MO -> zh-Hant;  other zh* -> zh-Hans;  ko*, ja*, en* -> same.
 * No match -> "en".
 */
export function pickLocale(languages: readonly string[], stored: string | null): Locale {
  if (isLocale(stored)) return stored;
  for (const language of languages) {
    const [primary, ...rest] = language.toLowerCase().split("-");
    if (primary === "zh") {
      if (rest.includes("hant")) return "zh-Hant";
      if (rest.includes("hans")) return "zh-Hans";
      return ["tw", "hk", "mo"].includes(rest[0]) ? "zh-Hant" : "zh-Hans";
    }
    if (primary === "ko" || primary === "ja" || primary === "en") return primary;
  }
  return "en";
}

/** The remembered choice, or null when storage is missing or throws. */
export function storedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remembers the user's choice for the next visit. Storage errors are ignored. */
export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
}

type Params = Readonly<Record<string, string>>;

/** Pure lookup. "{name}" placeholders come from params; unknown ones stay as-is. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  return DICTIONARIES[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match);
}

export function t(key: MessageKey, params?: Params): string {
  return translate(i18n.locale, key, params);
}
