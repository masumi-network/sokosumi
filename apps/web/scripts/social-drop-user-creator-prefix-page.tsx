/** Playwright capture page for Social post creator labels. */
import { createRoot } from "react-dom/client";
import { socialPostCreatorLabel } from "@/app/projects/components/social-posts/social-post-creator-label";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { useMountEffect } from "@/hooks/use-mount-effect";

const ROWS = [
  {
    id: "user",
    handle: "@sokosumi",
    text: "Draft for Monday.",
    creator: { kind: "user" as const, id: "user-1", name: "Alice" },
    kindLabel: "User",
  },
  {
    id: "coworker",
    handle: "@sokosumi-co",
    text: "Coworker draft.",
    creator: { kind: "coworker" as const, id: "coworker-1", name: "Scout" },
    kindLabel: "Coworker",
  },
];

export function SocialDropUserCreatorPrefixPage() {
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  return (
    <div className="bg-muted p-6">
      <ul
        className="mx-auto w-full max-w-xl space-y-3"
        data-testid="social-post-creator-rows"
      >
        {ROWS.map((row) => (
          <li
            className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3"
            data-testid={`social-post-${row.id}`}
            key={row.id}
          >
            <span
              aria-hidden
              className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
            >
              <SocialPostProviderIcon className="size-5" provider="x" />
            </span>
            <div className="min-w-48 flex-1 space-y-1.5">
              <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="min-w-0 truncate">{row.handle}</span>
                <SocialPostStatusBadge
                  className="order-first"
                  label="Draft"
                  status="DRAFT"
                />
              </p>
              <p className="text-sm whitespace-pre-wrap break-words">
                {row.text}
              </p>
              <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>
                  {socialPostCreatorLabel(row.creator, row.kindLabel)}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  const root = document.getElementById("fixture");
  if (root) {
    try {
      createRoot(root).render(<SocialDropUserCreatorPrefixPage />);
    } catch (error) {
      document.body.dataset.moduleError = String(error);
    }
  }
}
