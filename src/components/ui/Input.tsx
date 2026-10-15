import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  children?: ReactNode;
}

export function Input({ label, className = "", ...props }: InputProps) {
  return (
    <label className="flex flex-col gap-1 w-full">
      {label ? (
        <span className="text-xs font-medium text-fg-muted uppercase tracking-wide">
          {label}
        </span>
      ) : null}
      <input className={`input ${className}`} {...props} />
    </label>
  );
}