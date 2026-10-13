import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, ...props }: InputProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label ? (
        <span className="text-fg-muted text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      ) : null}
      <input className={`input ${className ?? ""}`} {...props} />
    </label>
  );
}