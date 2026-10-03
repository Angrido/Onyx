export const OPEN_PALETTE_EVENT = "onyx:command-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function isPaletteShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
}
