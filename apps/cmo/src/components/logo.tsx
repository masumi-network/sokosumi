/**
 * The mascot's head, a pointer with eyes, beside the name. Black and white
 * like the mascot in both colour schemes; the black outline merges into a dark
 * page and leaves the white pointer, as in the app icon.
 */
export function Logo() {
  return (
    <span className="logo">
      <svg
        aria-hidden="true"
        className="logo-mark"
        viewBox="14 4 37 56"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M18.2 7.1 17.1 53.9 27.6 43.4 32 56 39.7 52.8 35.8 40.7 47.4 39.6Z"
          fill="#fff"
          stroke="#0a0a0a"
          strokeLinejoin="round"
          strokeWidth="4.5"
        />
        <ellipse cx="24.8" cy="29.4" fill="#0a0a0a" rx="2.3" ry="3.9" />
        <ellipse cx="31.4" cy="28.7" fill="#0a0a0a" rx="2.3" ry="3.9" />
      </svg>
      CMO.XYZ
    </span>
  );
}
