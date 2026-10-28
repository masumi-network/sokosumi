import type { CmoOverview } from "@sokosumi/core-client";

function saturation(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) =>
    Number.parseInt(hex.slice(at, at + 2), 16),
  );
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** The brand's colours, the most vivid first: dark navies read as text, not brand. */
export function vividColors(colors: string[]): string[] {
  return [...colors].sort((a, b) => saturation(b) - saturation(a));
}

/** The business as it names itself ("Cal.com"), else its domain. */
export function businessDisplayName(overview: CmoOverview): string {
  const siteName = overview.brandVisual?.siteName;
  return siteName && siteName.length <= 40 ? siteName : overview.businessName;
}

/**
 * The business's own mark: its site icon (favicon), which is drawn to read
 * small; a logo read off the page only when there is none (on apple.com that
 * was a black strip); else its initial.
 */
export function BusinessMark({
  overview,
  size = 28,
  wide = false,
}: {
  overview: CmoOverview;
  size?: number;
  /** Where room allows, a wordmark keeps its shape instead of a square. */
  wide?: boolean;
}) {
  const logo = overview.projectLogo ?? overview.brandVisual?.logoUrl;
  const accent = vividColors(overview.brandVisual?.colors ?? [])[0];
  if (logo) {
    return (
      <img
        className="ob-mark"
        src={logo}
        alt=""
        width={size}
        height={size}
        style={
          wide
            ? {
                width: "auto",
                height: size,
                minWidth: size,
                maxWidth: size * 4,
              }
            : { width: size, height: size }
        }
      />
    );
  }
  return (
    <span
      className="ob-mark ob-mark-letter"
      style={{
        width: size,
        height: size,
        ...(accent ? { background: accent, color: "var(--mark-white)" } : {}),
      }}
      aria-hidden="true"
    >
      {overview.businessName.charAt(0).toUpperCase()}
    </span>
  );
}
