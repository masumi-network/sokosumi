/** Playwright capture page for Social draft-row account labels. */
import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";
import { socialPostAccountLabel } from "./social-post-account-label";
import { SocialPostStatusBadge } from "./social-post-status-badge";

const CONNECTION = {
  displayName: "Sokosumi HQ",
  externalHandle: "sokosumi",
};

export function RowDisplayNamePage() {
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  const accountLabel = socialPostAccountLabel(CONNECTION, "No account");

  return (
    <NextIntlClientProvider
      formats={createFormats("h23")}
      locale="en"
      messages={messages}
      timeZone="UTC"
    >
      <div
        className="bg-muted min-h-screen p-6"
        style={{ minHeight: "100vh", padding: 24 }}
      >
        <ul
          style={{
            margin: "0 auto",
            width: 560,
            maxWidth: "100%",
            listStyle: "none",
            padding: 0,
          }}
        >
          <li
            className="bg-background border-border rounded-lg border p-3"
            data-testid="social-post-post-draft"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              width: "100%",
            }}
          >
            <span
              aria-hidden
              className="bg-background size-9 rounded-md border"
              style={{
                display: "flex",
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
              }}
            >
              <SocialPostProviderIcon className="size-5" provider="x" />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                className="text-muted-foreground text-sm"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "4px 8px",
                  minHeight: 36,
                  margin: 0,
                }}
              >
                <SocialPostStatusBadge label="Draft" status="DRAFT" />
                <span style={{ minWidth: 0, overflow: "hidden" }}>
                  {accountLabel}
                </span>
              </p>
              <p className="text-sm" style={{ margin: "6px 0 0" }}>
                Launch note for Monday.
              </p>
              <p
                className="text-muted-foreground text-xs"
                style={{ margin: "6px 0 0" }}
              >
                User · Alice
              </p>
            </div>
          </li>
        </ul>
      </div>
    </NextIntlClientProvider>
  );
}

export function mountRowDisplayNamePage() {
  const root = document.getElementById("fixture");
  if (!root) throw new Error("Missing #fixture");
  createRoot(root).render(<RowDisplayNamePage />);
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  try {
    mountRowDisplayNamePage();
  } catch (error) {
    document.body.dataset.moduleError = String(error);
  }
}
