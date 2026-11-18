/**
 * The CMO.XYZ logo: the approved stacked-text lockup from the Masumi Family
 * Brand Guide (`logos/cmo-xyz/lockups`), copied unchanged into `public/logo`.
 * The black file is for a light page and the white one for a dark page;
 * `globals.css` shows the one that fits the theme. Never recolour either.
 */
export function Logo() {
  return (
    <span aria-label="CMO.xyz" className="logo" role="img">
      <img
        alt=""
        className="logo-on-light"
        src="/logo/cmo-xyz-lockup-stacked-text-black.svg"
      />
      <img
        alt=""
        className="logo-on-dark"
        src="/logo/cmo-xyz-lockup-stacked-text-white.svg"
      />
    </span>
  );
}
