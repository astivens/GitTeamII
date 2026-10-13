import type { SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, className, children, ...props }: SelectProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label ? (
        <span className="text-fg-muted text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      ) : null}
      <select
        className={`input appearance-none pr-8 ${className ?? ""}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}