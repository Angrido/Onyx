"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Item } from "./types";

export interface ItemListProps {
  items: readonly Item[];
  /** Rendered when the list is empty. */
  empty?: ReactNode;
  onSelect?: (item: Item) => void;
}

type Density = "compact" | "comfortable";

const DENSITY_CLASSES: Record<Density, string> = {
  compact: "gap-1 text-sm",
  comfortable: "gap-3 text-base",
};

/** Shows a selectable list of items. */
export function ItemList({ items, empty = null, onSelect }: ItemListProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  if (sorted.length === 0) return <>{empty}</>;
  return (
    <ul className={cn("flex flex-col", DENSITY_CLASSES.compact)}>
      {sorted.map((item) => (
        <li key={item.id} onClick={() => { setSelected(item.id); onSelect?.(item); }}>
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export const ItemBadge = memo(function ItemBadge({ item }: { item: Item }) {
  return <span className="badge">{item.name}</span>;
});

export default function Page() {
  return <ItemList items={[]} />;
}
