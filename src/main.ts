import {
  ADJUST_KEYS,
  BLEND_MODES,
  IDENTITY_EDIT,
  addLayer,
  autoAdjust,
  flipHorizontal,
  moveLayer,
  removeLayer,
  render,
  resetColor,
  rotateLeft,
  rotateRight,
  setAdjust,
  setLayerColor,
  setLayerMode,
  setLayerOpacity,
  type AdjustKey,
  type BlendMode,
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

interface LayerCard {
  readonly element: HTMLLIElement;
  readonly color: HTMLInputElement;
  readonly mode: HTMLSelectElement;
  readonly opacity: HTMLInputElement;
  readonly value: HTMLOutputElement;
  readonly up: HTMLButtonElement;
  readonly down: HTMLButtonElement;
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

const LAYER_ICONS = {
  layerUp: '<path d="m6 15 6-6 6 6"/>',
  layerDown: '<path d="m6 9 6 6 6-6"/>',
  layerRemove: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
} satisfies Partial<Record<MessageKey, string>>;

/** Static elements of index.html and their text. index.html itself carries no message keys. */
const STATIC_LABELS = {
  "app-title": "appTitle",
  "language-label": "language",
  open: "openFiles",
  "drop-label": "openFiles",
  "drop-hint": "dropHint",
  "adjust-title": "adjustments",
  "layer-title": "layer",
  "add-layer": "layerAdd",
  auto: "autoAdjust",
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
/** Indexed like `Edit.layers`, bottom first. Rebuilt only when the layer count changes, so a drag keeps its pointer. */
const layerCards: LayerCard[] = [];
const controls: (HTMLButtonElement | HTMLInputElement | HTMLSelectElement)[] = [];

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
  for (const id of ["open", "drop"]) byId(id).addEventListener("click", () => files.click());
  files.addEventListener("change", () => {
    addFiles([...(files.files ?? [])]);
    files.value = "";
  });

  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    byId("stage").classList.add("dragging");
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) byId("stage").classList.remove("dragging");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    byId("stage").classList.remove("dragging");
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
      // The strip only helps once there is something to switch to.
      byId("list").hidden = items.size < 2;
      byId("drop").hidden = true;
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
  const name = document.createElement("span");
  name.className = "caption-name";
  name.textContent = item.source.file.name;
  const kind = label(document.createElement("span"), `kind_${item.source.kind}`);
  kind.className = `kind kind-${item.source.kind}`;
  byId("caption").replaceChildren(name, kind);
  byId("toolbar").hidden = false;
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
  });
}

/** A thumbnail button in the strip; the file name is its accessible name and tooltip. */
function renderListItem(id: ItemId, source: Source): ListRow {
  const element = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-current", "false");
  button.setAttribute("aria-label", source.file.name);
  button.title = source.file.name;
  button.addEventListener("click", () => void select(id));

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  button.append(canvas);
  element.append(button);
  return { element, button, canvas };
}

function paintThumb(item: Item): void {
  draw(item.row.canvas, render(item.thumb, item.edit));
}

/** Built from ORIENT_ACTIONS and ADJUST_KEYS; nothing in index.html lists them. Layer cards come from `syncControls`. */
function buildEditorControls(): void {
  const orient = byId("orient");
  for (const [key, op] of Object.entries(ORIENT_ACTIONS) as [keyof typeof ORIENT_ACTIONS, (e: Edit) => Edit][]) {
    const button = iconButton(key, ORIENT_ICONS[key]);
    button.addEventListener("click", () => updateEdit(op));
    orient.append(button);
    controls.push(button);
  }

  const container = byId("sliders");
  for (const key of ADJUST_KEYS) {
    const field = document.createElement("label");
    field.className = "slider";
    const value = document.createElement("output");
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: "-100", max: "100", step: "1", value: "0" });
    input.addEventListener("input", () => updateEdit((e) => setAdjust(e, key, Number(input.value))));
    field.append(label(document.createElement("span"), `adjust_${key}`), input, value);
    container.append(field);
    sliders.set(key, { input, value });
    controls.push(input);
  }

  const add = byId<HTMLButtonElement>("add-layer");
  add.addEventListener("click", () => {
    const item = selectedItem();
    if (item) updateEdit((e) => addLayer(e, item.thumb));
  });
  controls.push(add);

  const auto = byId<HTMLButtonElement>("auto");
  auto.addEventListener("click", () => {
    const item = selectedItem();
    if (item) updateEdit((e) => autoAdjust(e, item.thumb));
  });
  const reset = byId<HTMLButtonElement>("reset");
  reset.addEventListener("click", () => updateEdit(resetColor));
  const save = byId<HTMLButtonElement>("save");
  save.addEventListener("click", () => void saveSelected());
  controls.push(auto, reset, save);
}

function iconButton(key: MessageKey, paths: string): HTMLButtonElement {
  const button = accessibleName(document.createElement("button"), key);
  button.type = "button";
  button.className = "icon";
  button.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return button;
}

/** Controls for `Edit.layers[index]`. Values are filled by `syncControls`. */
function buildLayerCard(index: number): LayerCard {
  const color = accessibleName(document.createElement("input"), "layerColor");
  color.type = "color";
  color.addEventListener("input", () => updateEdit((e) => setLayerColor(e, index, color.value)));
  const mode = accessibleName(document.createElement("select"), "layerMode");
  for (const key of Object.keys(BLEND_MODES) as BlendMode[]) mode.append(label(new Option("", key), `blend_${key}`));
  mode.addEventListener("change", () => updateEdit((e) => setLayerMode(e, index, mode.value)));
  const opacity = accessibleName(document.createElement("input"), "layerOpacity");
  Object.assign(opacity, { type: "range", min: "0", max: "100", step: "1" });
  opacity.addEventListener("input", () => updateEdit((e) => setLayerOpacity(e, index, Number(opacity.value))));
  const value = document.createElement("output");

  const up = iconButton("layerUp", LAYER_ICONS.layerUp);
  const down = iconButton("layerDown", LAYER_ICONS.layerDown);
  const move = (step: 1 | -1): void => {
    updateEdit((e) => moveLayer(e, index, step));
    // Keep focus on the layer that moved; at the top or bottom its button in that direction is disabled.
    const moved = layerCards[index + step];
    const [ahead, back] = step === 1 ? [moved.up, moved.down] : [moved.down, moved.up];
    (ahead.disabled ? back : ahead).focus();
  };
  up.addEventListener("click", () => move(1));
  down.addEventListener("click", () => move(-1));
  const remove = iconButton("layerRemove", LAYER_ICONS.layerRemove);
  remove.addEventListener("click", () => {
    updateEdit((e) => removeLayer(e, index));
    byId("add-layer").focus();
  });

  const element = document.createElement("li");
  element.className = "layer";
  const look = document.createElement("div");
  look.className = "layer-row";
  look.append(color, mode);
  const strength = document.createElement("div");
  strength.className = "layer-row";
  strength.append(opacity, value);
  const actions = document.createElement("div");
  actions.className = "layer-row";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  actions.append(up, down, spacer, remove);
  element.append(look, strength, actions);
  return { element, color, mode, opacity, value, up, down };
}

/** Edit -> control values. Never reads controls back into state. Null disables every control. */
function syncControls(edit: Edit | null): void {
  for (const control of controls) control.disabled = edit === null;
  for (const [key, { input, value }] of sliders) {
    const level = edit?.adjust[key] ?? 0;
    input.value = String(level);
    value.textContent = level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0";
  }
  const { layers } = edit ?? IDENTITY_EDIT;
  if (layerCards.length !== layers.length) {
    layerCards.splice(0, Infinity, ...layers.map((_, i) => buildLayerCard(i)));
    byId("layers").replaceChildren(...layerCards.map((card) => card.element).reverse());
  }
  layers.forEach((layer, i) => {
    const card = layerCards[i];
    card.color.value = `#${layer.color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    card.mode.value = layer.mode;
    card.opacity.value = String(layer.opacity);
    card.value.textContent = `${layer.opacity}%`;
    card.up.disabled = i === layers.length - 1;
    card.down.disabled = i === 0;
  });
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
