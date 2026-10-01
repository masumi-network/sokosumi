/**
 * The mascot's head, a pointer with eyes, beside the name. Black and white
 * like the mascot in both colour schemes; the black outline merges into a dark
 * page and leaves the white pointer, as in the app icon.
 */
export function Logo() {
  return (
    <span className="logo">
      <img
        alt=""
        className="logo-mark"
        height={56}
        src="/logo.svg"
        width={37}
      />
      CMO.XYZ
    </span>
  );
}
