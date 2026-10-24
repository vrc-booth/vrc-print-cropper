<script lang="ts" module>
  /** 24-unit line icons, drawn with `currentColor`. */
  export const ICONS = {
    rotateLeft: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
    rotateRight: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"],
    flipHorizontal: ["M12 3v18", "M8 7 3 12l5 5V7z", "M16 7l5 5-5 5V7z"],
    layerUp: ["m6 15 6-6 6 6"],
    layerDown: ["m6 9 6 6 6-6"],
    layerRemove: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  } as const;
</script>

<script lang="ts">
  let { name }: { name: keyof typeof ICONS } = $props();
</script>

<svg
  width="20"
  height="20"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each ICONS[name] as d (d)}<path {d} />{/each}
</svg>
