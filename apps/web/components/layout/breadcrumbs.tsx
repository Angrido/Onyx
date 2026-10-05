import { ChevronRight } from "lucide-react";
import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, label }: { items: readonly Crumb[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 normal-case tracking-normal">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            {item.href ? (
              <Link
                href={item.href}
                className="truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-xs text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
