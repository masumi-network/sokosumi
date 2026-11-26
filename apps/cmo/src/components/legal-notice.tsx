export function LegalNotice() {
  return (
    <p className="note legal-notice">
      Subscriptions are subject to our{" "}
      <a href="https://www.cmo.xyz/terms" target="_blank" rel="noreferrer">
        Terms of Service
      </a>
      . Read our{" "}
      <a href="https://www.cmo.xyz/privacy" target="_blank" rel="noreferrer">
        Privacy Policy
      </a>
      ,{" "}
      <a href="https://www.cmo.xyz/dpa" target="_blank" rel="noreferrer">
        Data Processing Agreement
      </a>{" "}
      and{" "}
      <a href="https://www.cmo.xyz/imprint" target="_blank" rel="noreferrer">
        Imprint
      </a>
      .
    </p>
  );
}

/** The Subscribe step's one line under the button: cancelling, then the terms. */
export function ShortLegalNotice() {
  return (
    <p className="note legal-notice">
      By subscribing you agree to the{" "}
      <a href="https://www.cmo.xyz/terms" target="_blank" rel="noreferrer">
        Terms
      </a>
      .{" "}
      <a href="https://www.cmo.xyz/privacy" target="_blank" rel="noreferrer">
        Privacy
      </a>{" "}
      ·{" "}
      <a href="https://www.cmo.xyz/dpa" target="_blank" rel="noreferrer">
        DPA
      </a>{" "}
      ·{" "}
      <a href="https://www.cmo.xyz/imprint" target="_blank" rel="noreferrer">
        Imprint
      </a>
    </p>
  );
}
