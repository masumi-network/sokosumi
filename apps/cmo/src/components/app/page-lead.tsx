import type { ReactNode } from "react";

interface PageLeadProps {
  kicker: string;
  /** Left out where the page's own headline follows (Strategy's goal). */
  title?: string;
  line?: ReactNode;
  /** What sits at the lead's right: the Calendar's count, Strategy's approval. */
  children?: ReactNode;
}

/**
 * The head of an app page: a small grey kicker that names it, the headline
 * that answers what the owner came for, and maybe one line more.
 */
export function PageLead({ kicker, title, line, children }: PageLeadProps) {
  return (
    <header className="page-lead">
      <div className="page-lead-text">
        <p className="page-kicker">{kicker}</p>
        {title ? <h1 className="page-title">{title}</h1> : null}
        {line ? <p className="page-line">{line}</p> : null}
      </div>
      {children ? <div className="page-lead-aside">{children}</div> : null}
    </header>
  );
}
