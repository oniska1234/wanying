interface AdSlotProps {
  /** visual size variant */
  variant?: "banner" | "square" | "inline";
  className?: string;
}

/**
 * 预留广告位占位组件。
 * 接入广告联盟（如 Google AdSense）时，替换内部为对应广告单元即可。
 */
export default function AdSlot({
  variant = "banner",
  className = "",
}: AdSlotProps) {
  const height =
    variant === "banner"
      ? "h-24"
      : variant === "square"
        ? "h-64"
        : "h-16";

  return (
    <div
      className={`grid place-items-center rounded-xl border border-dashed border-ink/15 bg-paper-2/60 ${height} ${className}`}
      data-ad-slot={variant}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink/30">
        广告位 · AD
      </span>
    </div>
  );
}
