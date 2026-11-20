export function SiteDisclosures() {
  return (
    <div className="site-disclosures note">
      <div className="foot-ai">
        <img
          src="/site/assets/ai-generated.png"
          alt="AI-generated content mark"
          width="32"
          height="32"
          loading="lazy"
        />
        <p>Some of the content on this site is AI generated.</p>
      </div>
      <a
        className="foot-pref"
        href="https://www.google.com/preferences/source?q=cmo.xyz"
        target="_blank"
        rel="noreferrer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"
          />
          <path
            fill="currentColor"
            d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6C4.8 19.8 8.1 22 12 22z"
          />
          <path
            fill="currentColor"
            d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1C2.4 8.8 2 10.4 2 12s.4 3.2 1.1 4.6L6.4 14z"
          />
          <path
            fill="currentColor"
            d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2 8.1 2 4.8 4.2 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z"
          />
        </svg>
        Add as preferred source
      </a>
    </div>
  );
}
