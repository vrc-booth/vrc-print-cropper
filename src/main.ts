import {
  ADJUST_KEYS,
  IDENTITY_EDIT,
  flipHorizontal,
  render,
  resetAdjust,
  rotateLeft,
  rotateRight,
  setAdjust,
  type AdjustKey,
  type Edit,
  type Pixels,
} from "./edit";
import {
  LOCALES,
  accessibleName,
  label,
  pickLocale,
  setLocale,
  storeLocale,
  storedLocale,
  t,
  translate,
  type Locale,
  type MessageKey,
} from "./i18n";
import { PREVIEW_SIDE, exportSource, openSource, readSource, type Source } from "./source";
import "./style.css";

declare const itemId: unique symbol;
type ItemId = number & { readonly [itemId]: true };

interface Item {
  readonly id: ItemId;
  readonly source: Source;
  /** Cropped, small. Re-rendered through `render` on every edit, so the list shows the edit too. */
  readonly thumb: Pixels;
  edit: Edit;
  readonly row: ListRow;
}

interface ListRow {
  readonly element: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
}

/** Orientation buttons, keyed by their message key, so the button list and its labels cannot drift. */
const ORIENT_ACTIONS = { rotateLeft, rotateRight, flipHorizontal } satisfies Partial<Record<MessageKey, (e: Edit) => Edit>>;

const ORIENT_ICONS: Record<keyof typeof ORIENT_ACTIONS, string> = {
  rotateLeft: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  rotateRight: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  flipHorizontal: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>',
};

/** Static elements of index.html and their text. index.html itself carries no message keys. */
const STATIC_LABELS = {
  "app-title": "appTitle",
  "language-label": "language",
  "open-label": "openFiles",
  "drop-hint": "dropHint",
  "list-empty": "emptyList",
  "no-selection": "noSelection",
  "adjust-title": "adjustments",
  reset: "reset",
  save: "save",
  "privacy-note": "privacyNote",
} satisfies Record<string, MessageKey>;

const items = new Map<ItemId, Item>();
let selected: ItemId | null = null;
/** Downscaled photo region of the selected item. Null while it decodes. */
let preview: { readonly id: ItemId; readonly pixels: Pixels } | null = null;
let previewQueued = false;
let nextId = 0;
let opening = Promise.resolve();

const sliders = new Map<AdjustKey, { readonly input: HTMLInputElement; readonly value: HTMLOutputElement }>();
const controls: (HTMLButtonElement | HTMLInputElement)[] = [];

function byId<E extends HTMLElement>(id: string): E {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as E;
}

function selectedItem(): Item | undefined {
  return selected === null ? undefined : items.get(selected);
}

function main(): void {
  for (const [id, key] of Object.entries(STATIC_LABELS)) label(byId(id), key);
  accessibleName(byId("preview"), "preview");

  const picker = byId<HTMLSelectElement>("locale");
  for (const locale of LOCALES) picker.add(new Option(translate(locale, "languageName"), locale));
  const locale = pickLocale(navigator.languages, storedLocale());
  picker.value = locale;
  setLocale(locale);
  picker.addEventListener("change", () => {
    const chosen = picker.value as Locale;
    storeLocale(chosen);
    setLocale(chosen);
  });

  buildEditorControls();
  syncControls(null);

  const files = byId<HTMLInputElement>("files");
  const open = byId<HTMLButtonElement>("open");
  open.addEventListener("click", () => files.click());
  files.addEventListener("change", () => {
    addFiles([...(files.files ?? [])]);
    files.value = "";
  });

  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    open.classList.add("dragging");
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) open.classList.remove("dragging");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    open.classList.remove("dragging");
    addFiles([...(event.dataTransfer?.files ?? [])]);
  });
}

function addFiles(files: readonly File[]): void {
  opening = opening.then(() => openFiles(files));
}

/** Sequential on purpose: one decoded image in memory at a time; rows appear as each file finishes. */
async function openFiles(files: readonly File[]): Promise<void> {
  for (const file of files) {
    try {
      const { source, thumb } = await openSource(file);
      const id = nextId++ as ItemId;
      const item: Item = { id, source, thumb, edit: IDENTITY_EDIT, row: renderListItem(id, source) };
      items.set(id, item);
      byId("list").append(item.row.element);
      byId("list-empty").hidden = true;
      paintThumb(item);
      if (selected === null) void select(id);
    } catch {
      showStatus(t("loadFailed", { name: file.name }));
    }
  }
}

/** Idempotent: selecting the selected item does nothing. Late decodes for a no-longer-selected item are dropped. */
async function select(id: ItemId): Promise<void> {
  const item = items.get(id);
  if (selected === id || !item) return;
  selected = id;
  preview = null;
  byId("preview").hidden = true;
  for (const other of items.values()) other.row.button.setAttribute("aria-current", String(other.id === id));
  syncControls(item.edit);
  try {
    const pixels = await readSource(item.source, PREVIEW_SIDE);
    if (selected !== id) return;
    preview = { id, pixels };
    schedulePreview();
  } catch {
    if (selected === id) showStatus(t("loadFailed", { name: item.source.file.name }));
  }
}

/** The single write path for an edit. */
function updateEdit(change: (edit: Edit) => Edit): void {
  const item = selectedItem();
  if (!item) return;
  item.edit = change(item.edit);
  paintThumb(item);
  syncControls(item.edit);
  schedulePreview();
}

/** Saves the selected item. Double-clicking downloads twice; harmless, so no in-flight lock. */
async function saveSelected(): Promise<void> {
  const item = selectedItem();
  if (!item) return;
  const edit = item.edit;
  try {
    const saved = await exportSource(item.source, edit);
    download(saved.blob, saved.name);
  } catch {
    showStatus(t("saveFailed", { name: item.source.file.name }));
  }
}

/** Coalesces slider input to one render per frame. */
function schedulePreview(): void {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const item = selectedItem();
    if (!item || !preview || preview.id !== item.id) return;
    const canvas = byId<HTMLCanvasElement>("preview");
    draw(canvas, render(preview.pixels, item.edit));
    canvas.hidden = false;
    byId("no-selection").hidden = true;
  });
}

function renderListItem(id: ItemId, source: Source): ListRow {
  const element = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-current", "false");
  button.addEventListener("click", () => void select(id));

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "item-text";
  const fileName = document.createElement("span");
  fileName.className = "item-name";
  fileName.textContent = source.file.name;
  const kind = label(document.createElement("span"), `kind_${source.kind}`);
  kind.className = `kind kind-${source.kind}`;

  text.append(fileName, kind);
  button.append(canvas, text);
  element.append(button);
  return { element, button, canvas };
}

function paintThumb(item: Item): void {
  draw(item.row.canvas, render(item.thumb, item.edit));
}

/** Built from ORIENT_ACTIONS and ADJUST_KEYS; nothing in index.html lists them. */
function buildEditorControls(): void {
  const orient = byId("orient");
  for (const [key, op] of Object.entries(ORIENT_ACTIONS) as [keyof typeof ORIENT_ACTIONS, (e: Edit) => Edit][]) {
    const button = accessibleName(document.createElement("button"), key);
    button.type = "button";
    button.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ORIENT_ICONS[key]}</svg>`;
    button.addEventListener("click", () => updateEdit(op));
    orient.append(button);
    controls.push(button);
  }

  const container = byId("sliders");
  for (const key of ADJUST_KEYS) {
    const field = document.createElement("label");
    field.className = "slider";
    const head = document.createElement("span");
    head.className = "slider-head";
    const value = document.createElement("output");
    head.append(label(document.createElement("span"), `adjust_${key}`), value);
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: "-100", max: "100", step: "1", value: "0" });
    input.addEventListener("input", () => updateEdit((e) => setAdjust(e, key, Number(input.value))));
    field.append(head, input);
    container.append(field);
    sliders.set(key, { input, value });
    controls.push(input);
  }

  const reset = byId<HTMLButtonElement>("reset");
  reset.addEventListener("click", () => updateEdit(resetAdjust));
  const save = byId<HTMLButtonElement>("save");
  save.addEventListener("click", () => void saveSelected());
  controls.push(reset, save);
}

/** Edit -> control values. Never reads controls back into state. Null disables every control. */
function syncControls(edit: Edit | null): void {
  for (const control of controls) control.disabled = edit === null;
  for (const [key, { input, value }] of sliders) {
    const level = edit?.adjust[key] ?? 0;
    input.value = String(level);
    value.textContent = level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0";
  }
}

function draw(canvas: HTMLCanvasElement, px: Pixels): void {
  canvas.width = px.width;
  canvas.height = px.height;
  canvas.getContext("2d")!.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
}

function download(blob: Blob, fileName: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function showStatus(message: string): void {
  const line = document.createElement("p");
  line.textContent = message;
  byId("status").append(line);
}

main();
