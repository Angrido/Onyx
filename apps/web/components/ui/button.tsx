import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_0_0_1px_oklch(1_0_0/0.08)_inset,0_8px_24px_-12px_var(--primary)] hover:brightness-110",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-surface-3/80",
        outline: "border border-border-strong bg-transparent hover:bg-surface-2",
        ghost: "hover:bg-surface-2 text-muted-foreground hover:text-foreground",
        destructive:
          "bg-destructive/90 text-destructive-foreground hover:bg-destructive shadow-[0_8px_24px_-12px_var(--destructive)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type NativeButtonProps = ComponentProps<"button">;
type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends NativeButtonProps, ButtonVariantProps {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
