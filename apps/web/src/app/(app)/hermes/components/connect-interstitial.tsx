"use client";

import { ArrowUpRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HermesIntegrationProvider } from "@/lib/hermes/types";

interface ConnectInterstitialProps {
  /** When set, the modal is open and configured for this connect attempt. */
  pending: {
    /** Slug — drives the OAuth-provider label below. */
    provider: HermesIntegrationProvider;
    providerName: string;
    mode: "read" | "write";
  } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Identity provider behind each Composio toolkit. Drives the modal copy so
 * we never show "Continue to Google" when the user is connecting Outlook.
 * Keep this map in sync with `composio.client.ts` toolkit mappings.
 */
const AUTH_PROVIDER_BY_SLUG: Record<HermesIntegrationProvider, string> = {
  gmail: "Google",
  google_calendar: "Google",
  google_sheets: "Google",
  google_docs: "Google",
  outlook: "Microsoft",
  outlook_calendar: "Microsoft",
  teams: "Microsoft",
  slack: "Slack",
  linear: "Linear",
  jira: "Atlassian",
  github: "GitHub",
  notion: "Notion",
  hubspot: "HubSpot",
  twitter: "X",
  instagram: "Meta",
  youtube: "Google",
  linkedin: "LinkedIn",
};

/**
 * Shown right before we open the Composio OAuth popup. Sets the expectation
 * that the consent screen will look broad because Hermes uses Composio's
 * verified OAuth client — explicit so the user doesn't bail mid-consent
 * when they see "Send mail on your behalf" listed even though they clicked
 * "Connect (read only)".
 *
 * The two enforcement layers (Composio MCP allowed_tools whitelist +
 * orchestrator proxy stripping) are what actually keep Hermes to the chosen
 * mode — the consent screen just reflects the OAuth scope Composio
 * verified for.
 */
export default function ConnectInterstitial({
  pending,
  onConfirm,
  onCancel,
}: ConnectInterstitialProps) {
  const isOpen = pending !== null;
  const authProvider = pending
    ? AUTH_PROVIDER_BY_SLUG[pending.provider]
    : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="bg-primary/10 text-primary mb-3 flex size-10 items-center justify-center rounded-lg">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <DialogTitle>Heads up about the next screen</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {authProvider ?? "The provider"}'s consent screen will list broad
            permissions —{" "}
            <span className="text-foreground font-medium">that's normal</span>.
            Hermes connects through Composio, our integration provider, and
            Composio's OAuth app is verified for its full default scope set.
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="border-border/60 bg-card/40 mt-2 rounded-lg border p-4 text-sm">
            <div className="text-foreground mb-1.5 font-medium">
              You picked{" "}
              <span
                className={
                  pending.mode === "write"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {pending.mode === "write" ? "full access" : "read only"}
              </span>{" "}
              for {pending.providerName}.
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {pending.mode === "write"
                ? "Hermes will be able to read, send, and act in your account on your behalf."
                : `Hermes can only read. Even though ${authProvider ?? "the provider"} may list send/modify permissions, Hermes is locked to read-only on our side — it cannot send or modify anything in your account.`}
            </p>
          </div>
        ) : null}

        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            className="gap-1.5"
            onClick={onConfirm}
          >
            <span>Continue to {authProvider ?? "provider"}</span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
