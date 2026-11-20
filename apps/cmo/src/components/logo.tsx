/**
 * The CMO.XYZ logos: approved lockups from the Masumi Family Brand Guide
 * (`logos/cmo-xyz/lockups`), copied unchanged into `public/logo`. Each
 * lockup pairs the file approved on white (a light page) with the one
 * approved on black (a dark page); `globals.css` shows the one that fits the
 * theme. Never recolour one, and never put one on another background.
 */
const LOCKUPS = {
  /** The header: the mascot beside "CMO .XYZ". */
  stacked: ["stacked-text-black", "stacked-text-white"],
  /** The guide's primary: the outlined mascot on top, on white. */
  primary: ["mascot-top-outline-black", "mascot-top-white"],
  /** The framed panel. */
  framed: ["framed-black", "framed-white"],
  /** The knockout block: the letters are the page showing through. */
  block: ["block-black", "block-white"],
} as const;

export type Lockup = keyof typeof LOCKUPS;

interface LogoProps {
  lockup?: Lockup;
  className?: string;
}

export function Logo({ lockup = "stacked", className }: LogoProps) {
  const [onLight, onDark] = LOCKUPS[lockup];
  return (
    <span
      aria-label="CMO.xyz"
      className={["logo", className].filter(Boolean).join(" ")}
      role="img"
    >
      <img
        alt=""
        className="logo-on-light"
        src={`/logo/cmo-xyz-lockup-${onLight}.svg`}
      />
      <img
        alt=""
        className="logo-on-dark"
        src={`/logo/cmo-xyz-lockup-${onDark}.svg`}
      />
    </span>
  );
}
