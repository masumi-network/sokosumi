/** Playwright capture page for Social composer account chips. */
import { Check } from "lucide-react";
import { createRoot } from "react-dom/client";
import { accountChipLabel } from "@/app/projects/components/social-posts/social-post-account-chip-label";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { useMountEffect } from "@/hooks/use-mount-effect";

const CONNECTIONS = [
  {
    displayName: "Sokosumi HQ",
    externalHandle: "sokosumi",
    provider: "x" as const,
    selected: true,
  },
  {
    displayName: null,
    externalHandle: "sokosumi-co",
    provider: "linkedin" as const,
    selected: false,
  },
];

export function ComposerChipDisplayNamePage() {
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  return (
    <div className="bg-muted p-6" style={{ padding: 24 }}>
      <div
        data-testid="social-post-accounts"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          width: 560,
          maxWidth: "100%",
          margin: "0 auto",
        }}
      >
        {CONNECTIONS.map((connection) => {
          const label = accountChipLabel(connection, "Unknown account");
          return (
            <button
              aria-pressed={connection.selected}
              className={
                connection.selected
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground"
              }
              key={connection.provider}
              style={{
                display: "inline-flex",
                height: 32,
                flexShrink: 0,
                alignItems: "center",
                gap: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderStyle: "solid",
                paddingInlineStart: 4,
                paddingInlineEnd: 12,
                fontSize: 14,
                fontWeight: 500,
                background: "var(--background)",
              }}
              type="button"
            >
              <span
                className="bg-muted"
                style={{
                  display: "flex",
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                }}
              >
                <SocialPostProviderIcon
                  aria-hidden
                  className="size-3.5"
                  provider={connection.provider}
                />
              </span>
              <span>{label}</span>
              {connection.selected ? (
                <Check className="size-3.5" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  const root = document.getElementById("fixture");
  if (root) {
    try {
      createRoot(root).render(<ComposerChipDisplayNamePage />);
    } catch (error) {
      document.body.dataset.moduleError = String(error);
    }
  }
}
