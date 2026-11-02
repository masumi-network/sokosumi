import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export interface NewsletterSampleIssue {
  body: string;
  from: string;
  name: string;
  subject: string;
}

/**
 * What a newsletter looks like, behind the project selector: three sample
 * issues stacked like a fanned inbox, in the settings preview's issue chrome
 * (`newsletter-brand-preview.tsx`, which follows the email renderer): masthead,
 * subject, body, accent button, footer. Decoration only, so it is hidden from
 * readers and takes no clicks. Plain props, so the server page renders it.
 */
export function NewsletterNoProjectBackdrop({
  button,
  issues,
  unsubscribe,
}: {
  button: string;
  issues: readonly [
    NewsletterSampleIssue,
    NewsletterSampleIssue,
    NewsletterSampleIssue,
  ];
  unsubscribe: string;
}) {
  const [front, middle, back] = issues;
  return (
    <div
      aria-hidden
      inert
      className="pointer-events-none relative h-80 w-full max-w-md text-left select-none sm:h-72"
      data-testid="newsletter-backdrop"
    >
      <SampleIssue
        className="absolute inset-x-6 top-0 hidden -rotate-6 sm:block"
        issue={back}
        button={button}
        unsubscribe={unsubscribe}
      />
      <SampleIssue
        className="absolute inset-x-3 top-3 rotate-3"
        issue={middle}
        button={button}
        unsubscribe={unsubscribe}
      />
      <SampleIssue
        className="absolute inset-x-0 top-6"
        issue={front}
        button={button}
        unsubscribe={unsubscribe}
        initial
      />
    </div>
  );
}

function SampleIssue({
  button,
  className,
  initial = false,
  issue,
  unsubscribe,
}: {
  button: string;
  className: string;
  /** The front issue shows its masthead mark in the brand fill. */
  initial?: boolean;
  issue: NewsletterSampleIssue;
  unsubscribe: string;
}) {
  return (
    <article className={cn(HOLDER_ITEM_CLASS, "space-y-4 p-5", className)}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
            initial
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {issue.name.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{issue.name}</p>
          <p className="text-muted-foreground truncate text-xs">{issue.from}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold text-pretty">{issue.subject}</p>
        <p className="text-muted-foreground line-clamp-2 text-sm text-pretty">
          {issue.body}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <span className="bg-primary text-primary-foreground inline-flex rounded px-4 py-2 text-sm font-medium">
          {button}
        </span>
        <span className="text-muted-foreground text-xs underline underline-offset-2">
          {unsubscribe}
        </span>
      </div>
    </article>
  );
}
