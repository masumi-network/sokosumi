"use client";

import type { CmoSeoSuggestion } from "@sokosumi/core-client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { pagePath } from "./seo-research-format";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button button-secondary button-small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/** Google cuts a title near 60 characters and a description near 155. */
const SNIPPET_LIMITS = { title: 60, description: 155 } as const;

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** How the page shows in a Google result with this title or description. */
function SearchResult({
  change,
  text,
}: {
  change: CmoSeoSuggestion;
  text: string;
}) {
  const title = change.element === "title";
  return (
    <div className="seo-result">
      <span className="note">{pagePath(change.pageUrl)}</span>
      {title ? (
        <b className="seo-result-title">{cut(text, SNIPPET_LIMITS.title)}</b>
      ) : (
        <p className="note">{cut(text, SNIPPET_LIMITS.description)}</p>
      )}
    </div>
  );
}

/**
 * A page change as the owner sees it: what the page says today beside what
 * it says after, as a Google result for a title or description.
 */
export function BeforeAfter({
  change,
  newText,
}: {
  change: CmoSeoSuggestion;
  newText: string;
}) {
  const snippet =
    change.element === "title" || change.element === "description";
  const side = (label: string, text: string, after: boolean) => (
    <div className={after ? "seo-side seo-side-after" : "seo-side"}>
      <span className="label">{label}</span>
      {snippet ? <SearchResult change={change} text={text} /> : <p>{text}</p>}
      {after ? (
        <div>
          <CopyButton text={text} label="Copy" />
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="seo-before-after">
      {side("Now", change.currentText ?? "", false)}
      {side("After", newText, true)}
    </div>
  );
}
