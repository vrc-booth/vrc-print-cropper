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

let current: Locale = "en";

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

/** Sets the current locale, updates <html lang>, and re-labels `root`. */
export function setLocale(locale: Locale, root: ParentNode = document): void {
  current = locale;
  document.documentElement.lang = locale;
  relabel(root);
}

export function getLocale(): Locale {
  return current;
}

type Params = Readonly<Record<string, string>>;

/** Pure lookup. "{name}" placeholders come from params; unknown ones stay as-is. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  return DICTIONARIES[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match);
}

export function t(key: MessageKey, params?: Params): string {
  return translate(current, key, params);
}

/** Marks an element as translatable and fills its text now. The only way any element gets UI text. */
export function label<E extends HTMLElement>(el: E, key: MessageKey): E {
  el.dataset.i18n = key;
  el.textContent = t(key);
  return el;
}

/** Like `label`, for elements without visible text: sets aria-label and title instead. */
export function accessibleName<E extends Element>(el: E, key: MessageKey): E {
  el.setAttribute("data-i18n-name", key);
  el.setAttribute("aria-label", t(key));
  el.setAttribute("title", t(key));
  return el;
}

function relabel(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) label(el, el.dataset.i18n as MessageKey);
  for (const el of root.querySelectorAll("[data-i18n-name]")) accessibleName(el, el.getAttribute("data-i18n-name") as MessageKey);
}
