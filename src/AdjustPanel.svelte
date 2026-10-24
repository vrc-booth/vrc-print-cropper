<script lang="ts">
  import { tick } from "svelte";
  import {
    ADJUST_KEYS,
    IDENTITY_EDIT,
    addLayer,
    autoAdjust,
    autoLayers,
    moveLayer,
    removeLayer,
    resetColor,
    setAdjust,
    type Edit,
    type Pixels,
  } from "./edit";
  import { t } from "./i18n.svelte";
  import LayerCard from "./LayerCard.svelte";

  interface Props {
    /** The selected image's edit and thumbnail; null disables every control. */
    edit: Edit | null;
    thumb: Pixels | null;
    onchange: (change: (edit: Edit) => Edit) => void;
    onsave: () => void;
  }

  let { edit, thumb, onchange, onsave }: Props = $props();

  const shown = $derived(edit ?? IDENTITY_EDIT);
  /** Top layer first, as in Photoshop; `index` stays the position in `Edit.layers`. */
  const cards = $derived(shown.layers.map((layer, index) => ({ layer, index })).reverse());
  const cardElements: HTMLLIElement[] = $state([]);
  let addButton: HTMLButtonElement;

  const signed = (level: number): string => (level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0");

  /** Keeps focus on the layer that moved; at the top or bottom its button in that direction is disabled. */
  async function move(index: number, step: 1 | -1): Promise<void> {
    onchange((e) => moveLayer(e, index, step));
    await tick();
    const card = cardElements[index + step];
    const ahead = card.querySelector<HTMLButtonElement>(step === 1 ? ".up" : ".down")!;
    const back = card.querySelector<HTMLButtonElement>(step === 1 ? ".down" : ".up")!;
    (ahead.disabled ? back : ahead).focus();
  }

  async function remove(index: number): Promise<void> {
    onchange((e) => removeLayer(e, index));
    await tick();
    addButton.focus();
  }
</script>

<section class="pane adjust-pane">
  <div class="section-head">
    <h2>{t("adjustments")}</h2>
    <button type="button" disabled={!edit} onclick={() => thumb && onchange((e) => autoAdjust(e, thumb))}>{t("autoAdjust")}</button>
  </div>
  <div class="sliders">
    {#each ADJUST_KEYS as key (key)}
      <label class="slider">
        <span>{t(`adjust_${key}`)}</span>
        <input
          type="range"
          min="-100"
          max="100"
          step="1"
          value={shown.adjust[key]}
          disabled={!edit}
          oninput={(e) => onchange((ed) => setAdjust(ed, key, Number(e.currentTarget.value)))}
        />
        <output>{signed(shown.adjust[key])}</output>
      </label>
    {/each}
  </div>
  <div class="section-head">
    <h2>{t("layer")}</h2>
    <div class="head-actions">
      <button type="button" disabled={!edit} onclick={() => thumb && onchange((e) => autoLayers(e, thumb))}>{t("layerAuto")}</button>
      <button bind:this={addButton} type="button" disabled={!edit} onclick={() => thumb && onchange((e) => addLayer(e, thumb))}>
        {t("layerAdd")}
      </button>
    </div>
  </div>
  {#if cards.length > 0}
    <ol class="layers">
      {#each cards as { layer, index } (index)}
        <li class="layer" bind:this={cardElements[index]}>
          <LayerCard
            {layer}
            {index}
            count={cards.length}
            {onchange}
            onmove={(step) => move(index, step)}
            onremove={() => remove(index)}
          />
        </li>
      {/each}
    </ol>
  {/if}
  <div class="panel-actions">
    <button type="button" class="secondary" disabled={!edit} onclick={() => onchange(resetColor)}>{t("reset")}</button>
    <button type="button" class="primary" disabled={!edit} onclick={onsave}>{t("save")}</button>
  </div>
</section>
