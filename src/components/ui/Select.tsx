import type { SelectHTMLAttributes, ReactNode } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}

export function Select({ label, className = "", children, ...props }: SelectProps) {
  return (
    <label className="flex flex-col gap-1 w-full">
      {label ? (
        <span className="text-xs font-medium text-fg-muted uppercase tracking-wide">
          {label}
        </span>
      ) : null}
      <select
        className={`input ${className}`}
        style={{ appearance: "none" }}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}