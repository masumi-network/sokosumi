"use client";

import {
  ArrowLeftRight,
  Check,
  MoreHorizontal,
  Settings2,
  Unplug,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGoogleAvatar } from "./seo-google-avatar";
import {
  type SeoConnection,
  type SeoConnectionProvider,
  type SeoGoogleAccount,
  seoConnectionAccount,
  useSeoConnection,
} from "./use-seo-connection";

/** Search Console first: it is the first Google approval and the one most views need. */
export const SEO_GOOGLE_SOURCES: SeoConnectionProvider[] = [
  "search_console",
  "ga4",
];

type GoogleAccountsProps = {
  /** Opens the statistics settings. Left out where the card is inside them. */
  onSettings?: () => void;
};

/**
 * The Google accounts of the two statistics sources as one card: the account
 * at the top, one row with a check mark per source, and one menu for the rare
 * account actions. A source that is not connected offers its connection in
 * its row.
 */
export function SeoGoogleAccounts(props: GoogleAccountsProps) {
  const { data: session } = useSession();
  // A new viewer or workspace starts with a clean card: no action of the last one stays busy.
  return (
    <SeoGoogleAccountsCard
      key={JSON.stringify([
        session?.user.id,
        session?.session.activeOrganizationId,
      ])}
      {...props}
    />
  );
}

function SeoGoogleAccountsCard({ onSettings }: GoogleAccountsProps) {
  const t = useTranslations("App.Seo");
  const models = {
    search_console: useSeoConnection("search_console"),
    ga4: useSeoConnection("ga4"),
  } satisfies Record<SeoConnectionProvider, SeoConnection>;
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState<SeoConnectionProvider | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const connected = SEO_GOOGLE_SOURCES.filter(
    (provider) => models[provider].status.data?.status === "connected",
  );
  const accounts = connected.map((provider) =>
    seoConnectionAccount(models[provider].status.data),
  );
  // The card names the account only when every connected source has a known one. A source
  // without a known account must not look as if it is on the account above.
  const account = accounts.every((item) => item !== null)
    ? (accounts[0] ?? null)
    : null;
  const busy = SEO_GOOGLE_SOURCES.some(
    (provider) => models[provider].busy !== null,
  );
  const errors = SEO_GOOGLE_SOURCES.map((provider) => models[provider].error);
  const name = (provider: SeoConnectionProvider) => t(`statistics.${provider}`);
  return (
    <div
      className="content-rise bg-background overflow-hidden rounded-lg border"
      data-testid="seo-google-accounts"
    >
      {/* The rows rise one after the other: the account first, then each source. */}
      <div className="stagger divide-y [--stagger-step:50ms]">
        <div className="flex items-center gap-3 p-3">
          <SeoGoogleAvatar account={account} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {account?.name ??
                account?.email ??
                t(
                  connected.length
                    ? "connections.googleAccount"
                    : "connections.noneConnected",
                )}
            </p>
            {/* A name has the email under it. Without an account there is nothing more to say. */}
            {account?.name ? (
              <p className="text-muted-foreground truncate text-sm">
                {account.email}
              </p>
            ) : null}
          </div>
          {connected.length || onSettings ? (
            <DropdownMenu
              open={menu && !busy}
              // A press during a change must not open the menu when the change ends.
              onOpenChange={(open) => setMenu(open && !busy)}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  ref={trigger}
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  aria-label={t("connections.options")}
                  title={t("connections.options")}
                  className="max-md:min-h-10 max-md:min-w-10"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {onSettings ? (
                  <DropdownMenuItem onSelect={onSettings}>
                    <Settings2 />
                    {t("connections.settings")}
                  </DropdownMenuItem>
                ) : null}
                {connected.map((provider, index) => (
                  <Fragment key={provider}>
                    {index > 0 || onSettings ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                      {name(provider)}
                    </DropdownMenuLabel>
                    {/* The label above names the source. The full name holds the visible text,
                        so a voice command with that text still finds it. */}
                    <DropdownMenuItem
                      aria-label={t("connections.switchFor", {
                        provider: name(provider),
                      })}
                      onSelect={() => {
                        // The menu closes now: it must not open again when the switch ends.
                        setMenu(false);
                        void models[provider].connect();
                      }}
                    >
                      <ArrowLeftRight />
                      {t("connections.changeAccount")}
                    </DropdownMenuItem>
                    {/* One press must not remove the account: the reader confirms first. */}
                    <DropdownMenuItem
                      variant="destructive"
                      aria-label={t("connections.disconnect", {
                        provider: name(provider),
                      })}
                      onSelect={() => setAsking(provider)}
                    >
                      <Unplug />
                      {t("connections.disconnectAccount")}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {SEO_GOOGLE_SOURCES.map((provider) => (
          <SourceRow
            key={provider}
            provider={provider}
            name={name(provider)}
            model={models[provider]}
            shown={account}
          />
        ))}
      </div>
      {errors.some(Boolean) ? (
        <div className="border-t px-3 py-2">
          {errors.map((error, index) =>
            error ? (
              <p
                key={SEO_GOOGLE_SOURCES[index]}
                role="alert"
                className="text-destructive text-sm"
              >
                {error}
              </p>
            ) : null,
          )}
        </div>
      ) : null}
      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
      >
        <AlertDialogContent
          // The menu item that opened the question is gone: focus returns to the menu button.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          {asking ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("connections.disconnectTitle", {
                    provider: name(asking),
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("connections.disconnectBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void models[asking].disconnect();
                  }}
                >
                  {t("connections.disconnect", { provider: name(asking) })}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SourceRow({
  provider,
  name,
  model,
  shown,
}: {
  provider: SeoConnectionProvider;
  name: string;
  model: SeoConnection;
  /** The account the card's top row names. */
  shown: SeoGoogleAccount | null;
}) {
  const t = useTranslations("App.Seo");
  const status = model.status.data?.status;
  const connected = status === "connected";
  // Only a status that was read says "not connected". A failed read or an approval in
  // progress has no state here: the button and the error below say what it is.
  const state = connected
    ? "connections.connectedShort"
    : status === "not_connected"
      ? "connections.notConnected"
      : null;
  const account = seoConnectionAccount(model.status.data);
  // Another Google account than the one on top: the row names it.
  const own = account && account.email !== shown?.email ? account.email : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      {/* The text and the check say the state together: the colour is never the only sign. */}
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          connected && "bg-semantic-success text-semantic-success-foreground",
          state === "connections.notConnected" &&
            "border-muted-foreground border border-dashed",
        )}
      >
        {connected ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {name}
          {state ? <span className="sr-only">: {t(state)}</span> : null}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {own ?? t(`statistics.measures.${provider}`)}
        </p>
      </div>
      {connected ? null : (
        <SeoConnectionButton
          provider={provider}
          connectLabel={t("connections.connectShort")}
          compact
          model={model}
        />
      )}
    </div>
  );
}
