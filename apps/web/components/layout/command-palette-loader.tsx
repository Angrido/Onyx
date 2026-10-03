"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { isPaletteShortcut, OPEN_PALETTE_EVENT } from "@/lib/palette";

const CommandPalette = dynamic(
  () => import("@/components/layout/command-palette").then((loaded) => loaded.CommandPalette),
  { ssr: false },
);

export function CommandPaletteLoader() {
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (requested) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setRequested(true);
    };
    const onOpen = () => setRequested(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [requested]);

  return requested ? <CommandPalette initiallyOpen /> : null;
}
