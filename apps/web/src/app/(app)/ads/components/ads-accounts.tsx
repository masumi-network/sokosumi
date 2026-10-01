"use client";

import type {
  AvailableAdAccount,
  ProjectAdAccount,
  ProjectAdProvider,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
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
  attachAdAccounts,
  disconnectAdAccount,
  finalizeAdConnection,
  initiateAdConnection,
} from "@/lib/actions/ads/action";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import { AdsErrorCode } from "@/lib/actions/errors/error-codes/ads";
import { useComposioOAuthPopup } from "@/lib/composio/use-composio-oauth-popup";

import { AdAccountPickerDialog } from "./ad-account-picker-dialog";

const PROVIDERS = ["google_ads", "meta_ads"] as const satisfies readonly [
  ProjectAdProvider,
  ...ProjectAdProvider[],
];

interface PickerState {
  accounts: AvailableAdAccount[];
  connectionId: string;
  provider: ProjectAdProvider;
}

interface AdsAccountsProps {
  accounts: ProjectAdAccount[];
  projectId: string;
}

/**
 * The Accounts tab: connect Google Ads or Meta Ads through Composio's popup,
 * pick which of the login's ad accounts this project manages, and disconnect
 * them again. The list itself comes from the server, so writes revalidate
 * `/ads` rather than patching local state.
 */
export function AdsAccounts({ accounts, projectId }: AdsAccountsProps) {
  const t = useTranslations("App.Ads.accounts");
  const { runPopupOAuth } = useComposioOAuthPopup();
  const [connecting, setConnecting] = useState<ProjectAdProvider | null>(null);
  // Providers Core said it has no auth config for, until the page reloads.
  const [unavailable, setUnavailable] = useState<readonly ProjectAdProvider[]>(
    [],
  );
  const [noAccountsFound, setNoAccountsFound] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [disconnectTarget, setDisconnectTarget] =
    useState<ProjectAdAccount | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  function providerName(provider: ProjectAdProvider): string {
    return t(`providers.${provider}`);
  }

  function failConnect(
    provider: ProjectAdProvider,
    error?: { code: string },
  ): void {
    if (error?.code === AdsErrorCode.NOT_CONFIGURED) {
      setUnavailable((current) =>
        current.includes(provider) ? current : [...current, provider],
      );
      return;
    }
    toast.error(t("errors.connect", { provider: providerName(provider) }));
  }

  async function connect(provider: ProjectAdProvider): Promise<void> {
    const popupRun = await runPopupOAuth(async (flow) => {
      setNoAccountsFound(false);
      setConnecting(provider);

      try {
        const initiation = await initiateAdConnection({ projectId, provider });
        if (!initiation.ok) {
          failConnect(provider, initiation.error);
          return;
        }

        const { connectionId, redirectUrl } = initiation.value;
        flow.navigate(redirectUrl);
        const callback = await flow.waitForCallback();

        if (callback.kind === "cancelled") return;
        if (callback.kind === "timeout") {
          toast.error(t("errors.timeout"));
          return;
        }

        const { payload } = callback;
        if (
          payload.status === "error" ||
          !payload.sessionUri ||
          (payload.connectionId && payload.connectionId !== connectionId)
        ) {
          failConnect(provider);
          return;
        }

        const completion = await completeComposioAuthCallbackAction({
          connectionId,
          sessionUri: payload.sessionUri,
        });
        if (!completion.ok) {
          failConnect(provider, completion.error);
          return;
        }

        const finalization = await finalizeAdConnection({
          projectId,
          connectionId,
        });
        if (!finalization.ok) {
          failConnect(provider, finalization.error);
          return;
        }

        const { availableAccounts, connection } = finalization.value;
        if (availableAccounts.length === 0) {
          setNoAccountsFound(true);
          return;
        }
        if (!connection) {
          failConnect(provider);
          return;
        }
        setPicker({
          accounts: availableAccounts,
          connectionId: connection.id,
          provider,
        });
      } catch {
        failConnect(provider);
      } finally {
        setConnecting(null);
      }
    });

    if (popupRun.kind === "in_flight") toast.error(t("errors.inFlight"));
    if (popupRun.kind === "popup_blocked") {
      toast.error(t("errors.popupBlocked"));
    }
  }

  async function attach(externalAccountIds: string[]): Promise<void> {
    if (!picker) return;
    setIsAttaching(true);
    try {
      const result = await attachAdAccounts({
        projectId,
        adConnectionId: picker.connectionId,
        externalAccountIds,
      });
      if (!result.ok) {
        toast.error(t("errors.attach"));
        return;
      }
      toast.success(t("success.connected"));
      setPicker(null);
    } catch {
      toast.error(t("errors.attach"));
    } finally {
      setIsAttaching(false);
    }
  }

  async function disconnect(account: ProjectAdAccount): Promise<void> {
    setDisconnectingId(account.id);
    try {
      const result = await disconnectAdAccount({
        projectId,
        accountId: account.id,
      });
      if (!result.ok) {
        toast.error(t("errors.disconnect"));
        return;
      }
      toast.success(t("success.disconnected"));
    } catch {
      toast.error(t("errors.disconnect"));
    } finally {
      setDisconnectingId(null);
    }
  }

  const connectControls = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
        {PROVIDERS.map((provider) => {
          const isUnavailable = unavailable.includes(provider);
          const noteId = `ads-unavailable-${provider}`;
          return (
            <div
              key={provider}
              className="flex flex-col items-stretch gap-1.5 sm:items-start"
            >
              <Button
                aria-describedby={isUnavailable ? noteId : undefined}
                aria-busy={connecting === provider}
                disabled={isUnavailable || connecting !== null}
                onClick={() => void connect(provider)}
                type="button"
              >
                {t("connect", { provider: providerName(provider) })}
              </Button>
              {isUnavailable ? (
                <p className="text-muted-foreground text-xs" id={noteId}>
                  {t("unavailable", { provider: providerName(provider) })}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {noAccountsFound ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("noAccountsFound")}
        </p>
      ) : null}
    </div>
  );

  return (
    <section className="flex flex-col gap-6" data-testid="ads-accounts">
      {accounts.length === 0 ? (
        <EmptyState
          action={connectControls}
          description={t("emptyBody")}
          title={t("emptyTitle")}
        />
      ) : (
        <>
          {connectControls}
          <ul aria-label={t("listLabel")} className="flex flex-col gap-4">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {providerName(account.provider)} ·{" "}
                    {account.externalAccountId} · {account.currency}
                  </p>
                </div>
                <Button
                  aria-label={t("disconnectLabel", { name: account.name })}
                  className="self-start md:self-auto"
                  disabled={disconnectingId === account.id}
                  onClick={() => setDisconnectTarget(account)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("disconnect")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {picker ? (
        <AdAccountPickerDialog
          accounts={picker.accounts}
          isAttaching={isAttaching}
          onAttach={(ids) => void attach(ids)}
          onCancel={() => setPicker(null)}
          provider={picker.provider}
        />
      ) : null}

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("disconnectDialog.title", {
                name: disconnectTarget?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("disconnectDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (disconnectTarget) void disconnect(disconnectTarget);
              }}
            >
              {t("disconnectDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
