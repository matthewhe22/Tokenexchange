// Tenon (榫卯) brand mark: a beam whose tenon sits inside a post. Small sizes use a simplified, heavier
// drawing so the joint still reads at favicon and nav sizes. Colors are fixed brand colors, not theme tokens,
// so the mark looks the same on light and dark surfaces.
const WALNUT = "#2F211B";
const CREAM = "#F5EFE6";
const GOLD = "#E3A857";

export function TenonMark({ size = 28, title }: { size?: number; title?: string }) {
  const label = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} {...label} className="logo-mark">
      {size >= 48 ? (
        <>
          <rect width="64" height="64" rx="14" fill={WALNUT} />
          <rect x="34" y="12" width="18" height="40" rx="2" fill="none" stroke={CREAM} strokeWidth="3.5" />
          <path d="M34 24H12v16h22" fill="none" stroke={CREAM} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
          <rect x="33" y="28" width="15" height="8" rx="1.5" fill={GOLD} />
        </>
      ) : (
        <>
          <rect width="64" height="64" rx="12" fill={WALNUT} />
          <rect x="35" y="11" width="18" height="42" rx="2" fill="none" stroke={CREAM} strokeWidth="6" />
          <rect x="9" y="25" width="40" height="14" rx="2" fill={GOLD} />
        </>
      )}
    </svg>
  );
}

/** Mark plus wordmark. The Chinese name is shown next to the Latin one in both locales. */
export function TenonLogo({ size = 28, zh = true }: { size?: number; zh?: boolean }) {
  return (
    <span className="logo-lockup" style={{ fontSize: Math.round(size * 0.72) }}>
      <TenonMark size={size} />
      <span className="logo-word">Tenon</span>
      {zh && <span className="logo-zh">榫卯</span>}
    </span>
  );
}
