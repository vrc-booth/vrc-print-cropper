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

/**
 * A valid `stored` value wins. Otherwise the first entry of `languages` that maps, by BCP 47 prefix:
 *   zh-Hant*, zh-TW, zh-HK, zh-MO -> zh-Hant;  other zh* -> zh-Hans;  ko*, ja*, en* -> same.
 * No match -> "en".
 */
export function pickLocale(languages: readonly string[], stored: string | null): Locale {
  throw new Error("not implemented");
}

/** The remembered choice, or null when storage is missing or throws. */
export function storedLocale(): string | null {
  throw new Error("not implemented");
}

/** Sets the current locale, remembers it (storage errors ignored), updates <html lang>, and re-labels `root`. */
export function setLocale(locale: Locale, root: ParentNode = document): void {
  throw new Error("not implemented");
}

export function getLocale(): Locale {
  return current;
}

type Params = Readonly<Record<string, string>>;

/** Pure lookup. "{name}" placeholders come from params; unknown ones stay as-is. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  throw new Error("not implemented");
}

export function t(key: MessageKey, params?: Params): string {
  return translate(current, key, params);
}

/** Marks an element as translatable and fills it now. The only way any element gets UI text. */
export function label<E extends HTMLElement>(el: E, key: MessageKey): E {
  // TODO: el.dataset.i18n = key; el.textContent = t(key); return el
  throw new Error("not implemented");
}

function relabel(root: ParentNode): void {
  // TODO: for el of root.querySelectorAll<HTMLElement>("[data-i18n]"): el.textContent = t(el.dataset.i18n as MessageKey)
  throw new Error("not implemented");
}
