<script lang="ts">
  import { BLEND_MODES, setLayerColor, setLayerMode, setLayerOpacity, type BlendMode, type Edit, type Layer } from "./edit";
  import { t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    layer: Layer;
    /** Position in `Edit.layers`, bottom first. */
    index: number;
    count: number;
    onchange: (change: (edit: Edit) => Edit) => void;
    onmove: (step: 1 | -1) => void;
    onremove: () => void;
  }

  let { layer, index, count, onchange, onmove, onremove }: Props = $props();

  const MODES = Object.keys(BLEND_MODES) as BlendMode[];
  const hex = $derived(`#${layer.color.map((c) => c.toString(16).padStart(2, "0")).join("")}`);
</script>

<div class="layer-row">
  <input
    type="color"
    value={hex}
    aria-label={t("layerColor")}
    title={t("layerColor")}
    oninput={(e) => onchange((edit) => setLayerColor(edit, index, e.currentTarget.value))}
  />
  <select
    value={layer.mode}
    aria-label={t("layerMode")}
    title={t("layerMode")}
    onchange={(e) => onchange((edit) => setLayerMode(edit, index, e.currentTarget.value))}
  >
    {#each MODES as mode (mode)}<option value={mode}>{t(`blend_${mode}`)}</option>{/each}
  </select>
  <button type="button" class="icon" aria-label={t("layerRemove")} title={t("layerRemove")} onclick={onremove}>
    <Icon name="layerRemove" />
  </button>
</div>
<div class="layer-row">
  <input
    type="range"
    min="0"
    max="100"
    step="1"
    value={layer.opacity}
    aria-label={t("layerOpacity")}
    title={t("layerOpacity")}
    oninput={(e) => onchange((edit) => setLayerOpacity(edit, index, Number(e.currentTarget.value)))}
  />
  <output>{layer.opacity}%</output>
  <button
    type="button"
    class="icon up"
    aria-label={t("layerUp")}
    title={t("layerUp")}
    disabled={index === count - 1}
    onclick={() => onmove(1)}
  >
    <Icon name="layerUp" />
  </button>
  <button
    type="button"
    class="icon down"
    aria-label={t("layerDown")}
    title={t("layerDown")}
    disabled={index === 0}
    onclick={() => onmove(-1)}
  >
    <Icon name="layerDown" />
  </button>
</div>
