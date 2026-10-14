import { nameToColor, nameToInitials } from "../../lib/avatar";

interface AvatarProps {
  name: string;
  size?: number;
}

export function Avatar({ name, size = 24 }: AvatarProps) {
  const initials = nameToInitials(name);
  const bg = nameToColor(name);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full font-mono text-[10px] font-medium text-fg ${bg}`}
      style={{ height: size, width: size }}
    >
      {initials}
    </span>
  );
}