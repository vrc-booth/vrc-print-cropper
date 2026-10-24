<script lang="ts">
  import { IDENTITY_EDIT, flipHorizontal, render, rotateLeft, rotateRight, type Edit, type Pixels } from "./edit";
  import { LOCALES, i18n, pickLocale, storeLocale, storedLocale, t, translate, type Locale } from "./i18n.svelte";
  import { PREVIEW_SIDE, exportSource, openSource, readSource, type Source } from "./source";
  import AdjustPanel from "./AdjustPanel.svelte";
  import Icon from "./Icon.svelte";

  interface Item {
    readonly id: number;
    readonly source: Source;
    /** Cropped, small. Rendered through `render` with the edit, so the strip shows the edit too. */
    readonly thumb: Pixels;
    readonly edit: Edit;
  }

  /** Orientation buttons, keyed by their message and icon name. */
  const ORIENT_ACTIONS = { rotateLeft, rotateRight, flipHorizontal };
  const ORIENT_KEYS = Object.keys(ORIENT_ACTIONS) as (keyof typeof ORIENT_ACTIONS)[];

  let items: readonly Item[] = $state.raw([]);
  let selectedId: number | null = $state(null);
  /** Downscaled photo region of the selected item. Null while it decodes. */
  let preview: { readonly id: number; readonly pixels: Pixels } | null = $state.raw(null);
  /** The item whose preview the canvas shows; the canvas stays hidden until it matches the selection. */
  let drawnId: number | null = $state(null);
  let dragging = $state(false);
  let status: string[] = $state([]);
  let files: HTMLInputElement;
  let canvas: HTMLCanvasElement;
  let nextId = 0;
  let opening = Promise.resolve();
  let frame = 0;

  const selected = $derived(items.find((item) => item.id === selectedId));

  i18n.locale = pickLocale(navigator.languages, storedLocale());
  $effect(() => {
    document.documentElement.lang = i18n.locale;
  });

  // One render per frame however fast the sliders move.
  $effect(() => {
    const item = selected;
    const shown = preview;
    if (!item || !shown || shown.id !== item.id) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      draw(canvas, render(shown.pixels, item.edit));
      drawnId = item.id;
    });
  });

  function chooseLocale(locale: Locale): void {
    storeLocale(locale);
    i18n.locale = locale;
  }

  function addFiles(list: readonly File[]): void {
    opening = opening.then(() => openFiles(list));
  }

  /** Sequential on purpose: one decoded image in memory at a time; thumbnails appear as each file finishes. */
  async function openFiles(list: readonly File[]): Promise<void> {
    for (const file of list) {
      try {
        const { source, thumb } = await openSource(file);
        const item: Item = { id: nextId++, source, thumb, edit: IDENTITY_EDIT };
        items = [...items, item];
        if (selectedId === null) void select(item.id);
      } catch {
        status.push(t("loadFailed", { name: file.name }));
      }
    }
  }

  /** Idempotent: selecting the selected item does nothing. Late decodes for a no-longer-selected item are dropped. */
  async function select(id: number): Promise<void> {
    const item = items.find((other) => other.id === id);
    if (selectedId === id || !item) return;
    selectedId = id;
    preview = null;
    try {
      const pixels = await readSource(item.source, PREVIEW_SIDE);
      if (selectedId === id) preview = { id, pixels };
    } catch {
      if (selectedId === id) status.push(t("loadFailed", { name: item.source.file.name }));
    }
  }

  /** The single write path for an edit. */
  function updateEdit(change: (edit: Edit) => Edit): void {
    const item = selected;
    if (!item) return;
    const edit = change(item.edit);
    items = items.map((other) => (other.id === item.id ? { ...other, edit } : other));
  }

  /** Saves the selected item. Double-clicking downloads twice; harmless, so no in-flight lock. */
  async function save(): Promise<void> {
    const item = selected;
    if (!item) return;
    try {
      const saved = await exportSource(item.source, item.edit);
      download(saved.blob, saved.name);
    } catch {
      status.push(t("saveFailed", { name: item.source.file.name }));
    }
  }

  function draw(target: HTMLCanvasElement, px: Pixels): void {
    target.width = px.width;
    target.height = px.height;
    target.getContext("2d")!.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
  }

  function download(blob: Blob, fileName: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
</script>

<svelte:window
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={(event) => {
    if (event.relatedTarget === null) dragging = false;
  }}
  ondrop={(event) => {
    event.preventDefault();
    dragging = false;
    addFiles([...(event.dataTransfer?.files ?? [])]);
  }}
/>

<header class="bar">
  <h1>{t("appTitle")}</h1>
  <div class="bar-actions">
    <button id="open" type="button" onclick={() => files.click()}>{t("openFiles")}</button>
    <label class="language">
      <span>{t("language")}</span>
      <select value={i18n.locale} onchange={(e) => chooseLocale(e.currentTarget.value as Locale)}>
        {#each LOCALES as locale (locale)}<option value={locale}>{translate(locale, "languageName")}</option>{/each}
      </select>
    </label>
  </div>
</header>
<input
  bind:this={files}
  type="file"
  accept="image/*"
  multiple
  hidden
  onchange={() => {
    addFiles([...(files.files ?? [])]);
    files.value = "";
  }}
/>
<main class="layout">
  <section class="editor">
    <div class="stage" class:dragging>
      <!-- The preview is a picture for screen readers, not a drawing surface. -->
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas
        bind:this={canvas}
        role="img"
        aria-label={t("preview")}
        title={t("preview")}
        hidden={drawnId === null || drawnId !== selectedId || preview?.id !== selectedId}
      ></canvas>
      {#if items.length === 0}
        <button class="drop" type="button" onclick={() => files.click()}>
          <span>{t("openFiles")}</span>
          <span class="hint">{t("dropHint")}</span>
        </button>
      {/if}
    </div>
    {#if selected}
      <div class="toolbar">
        <p class="caption">
          <span class="caption-name">{selected.source.file.name}</span>
          <span class="kind kind-{selected.source.kind}">{t(`kind_${selected.source.kind}`)}</span>
        </p>
        <div class="orient">
          {#each ORIENT_KEYS as key (key)}
            <button type="button" class="icon" aria-label={t(key)} title={t(key)} onclick={() => updateEdit(ORIENT_ACTIONS[key])}>
              <Icon name={key} />
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <!-- The strip only helps once there is something to switch to. -->
    {#if items.length > 1}
      <ul class="strip">
        {#each items as item (item.id)}
          <li>
            <button
              type="button"
              aria-current={item.id === selectedId}
              aria-label={item.source.file.name}
              title={item.source.file.name}
              onclick={() => select(item.id)}
            >
              <canvas aria-hidden="true" {@attach (thumb: HTMLCanvasElement) => draw(thumb, render(item.thumb, item.edit))}></canvas>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
  <AdjustPanel edit={selected?.edit ?? null} thumb={selected?.thumb ?? null} onchange={updateEdit} onsave={save} />
</main>
<div class="status" aria-live="polite">
  {#each status as line, i (i)}<p>{line}</p>{/each}
</div>
<footer class="bar"><p>{t("privacyNote")}</p></footer>
