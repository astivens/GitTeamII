interface AvatarProps {
  name: string;
  size?: number;
}

/**
 * Avatar — initials in a colored bubble.
 * Background uses the accent color (violet) for brand consistency.
 */
export function Avatar({ name, size = 22 }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {initials || "·"}
    </span>
  );
}