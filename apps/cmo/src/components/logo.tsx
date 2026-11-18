/**
 * The CMO.XYZ lockup: the cursor-head mark (`public/logo.svg`) beside the
 * wordmark, set in PP Mori SemiBold in the text colour. The mark carries its
 * own white edge, so it reads on a light page and a dark one. Its size follows
 * the font size of the place it sits in.
 */
export function Logo() {
  return (
    <span aria-label="CMO.xyz" className="logo" role="img">
      <img alt="" src="/logo.svg" />
      <span aria-hidden="true">CMO.XYZ</span>
    </span>
  );
}
