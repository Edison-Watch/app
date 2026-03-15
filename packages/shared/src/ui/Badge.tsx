import type { ReactNode } from "react";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral" | "blocked";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  onClick?: (e: React.MouseEvent) => void;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  danger: "bg-red-500/15 text-red-400 border-red-500/30",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  neutral: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  blocked: "bg-violet-500/15 text-violet-400 border-violet-500/30",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-0.5 text-[11px]",
};

export default function Badge({
  variant = "neutral",
  size = "md",
  onClick,
  children,
}: BadgeProps) {
  const className = `inline-flex items-center font-medium rounded-full border ${variantStyles[variant]} ${sizeStyles[size]}${onClick ? " cursor-pointer hover:brightness-125" : ""}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    );
  }

  return (
    <span className={className}>
      {children}
    </span>
  );
}
