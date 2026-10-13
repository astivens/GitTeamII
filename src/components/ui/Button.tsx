import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

function variantClass(v: Variant): string {
  switch (v) {
    case "primary":
      return "btn-primary";
    case "outline":
      return "btn-outline";
    case "ghost":
    default:
      return "btn-ghost";
  }
}

export function Button({
  variant = "ghost",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${variantClass(variant)} ${className ?? ""}`}
      {...props}
    >
      {children}
    </button>
  );
}