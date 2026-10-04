export const OPEN_PALETTE_EVENT = "onyx:command-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function isPaletteShortcut(event: {
  key?: unknown;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  if (typeof event.key !== "string") return false;
  return event.key.toLowerCase() === "k" && (event.metaKey === true || event.ctrlKey === true);
}
