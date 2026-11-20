"use client";

import type { Account } from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { ReauthDialog } from "@/components/auth/reauth-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useReauthGate } from "@/hooks/use-reauth-gate";
import { authClient } from "@/lib/auth/auth.client";

function getPasskeyErrorMessage(
  fallbackMessage: string,
  error: { message?: unknown } | null,
): string {
  if (typeof error?.message !== "string" || error.message.length === 0) {
    return fallbackMessage;
  }

  return `${fallbackMessage}: ${error.message}`;
}

interface PasskeyRecord {
  createdAt: Date | string;
  id: string;
  name?: string | null;
}

interface PasskeySettingsProps {
  /** Linked accounts, so the re-authentication dialog offers the right method. */
  accounts: Account[];
  /**
   * False when the linked accounts failed to load. Only adding needs them,
   * because only adding can hit Core's freshness gate, so the rest of the
   * card keeps working: an existing passkey stays removable.
   */
  canAddPasskey: boolean;
}

export function PasskeySettings({
  accounts,
  canAddPasskey,
}: PasskeySettingsProps) {
  const t = useTranslations("App.Account.Passkeys");
  const formatter = useFormatter();
  const router = useRouter();
  const [isRetryingLoad, setIsRetryingLoad] = useState(false);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [passkeyNameDraft, setPasskeyNameDraft] = useState("");
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(
    null,
  );
  const [savingPasskeyId, setSavingPasskeyId] = useState<string | null>(null);
  const isMutatingPasskeys =
    isAddingPasskey || removingPasskeyId !== null || savingPasskeyId !== null;

  const reauthGate = useReauthGate({ accounts });

  const passkeysQuery = useQuery({
    queryKey: ["account", "passkeys"],
    queryFn: async (): Promise<PasskeyRecord[]> => {
      const result = await authClient.passkey.listUserPasskeys();

      if (result.error) {
        throw new Error(result.error.message || "Failed to load passkeys");
      }

      return result.data ?? [];
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const passkeys = passkeysQuery.data ?? [];
  const hasPasskeyLoadError = passkeysQuery.isError;
  const isLoadingPasskeys = passkeysQuery.isPending || isRetryingLoad;

  const { refetch: refetchPasskeys } = passkeysQuery;

  const reloadPasskeys = useCallback(
    async (options?: { showLoadingState?: boolean }) => {
      const showLoadingState = options?.showLoadingState !== false;
      if (showLoadingState) {
        setIsRetryingLoad(true);
      }

      try {
        const result = await refetchPasskeys();
        return !result.isError;
      } finally {
        if (showLoadingState) {
          setIsRetryingLoad(false);
        }
      }
    },
    [refetchPasskeys],
  );

  const sortedPasskeys = useMemo(() => {
    return [...passkeys].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }, [passkeys]);

  async function handleAddPasskey() {
    setIsAddingPasskey(true);

    try {
      const result = await authClient.passkey.addPasskey();

      if (result.error) {
        // Core gates passkey registration on a fresh session. The gate asks
        // the viewer to authenticate again, then they add the passkey again.
        if (reauthGate.handleError(result.error)) {
          return;
        }

        toast.error(getPasskeyErrorMessage(t("addError"), result.error));
        return;
      }

      if (!(await reloadPasskeys({ showLoadingState: false }))) {
        toast.error(t("refreshError"));
        return;
      }

      router.refresh();
      toast.success(t("addSuccess"));
    } catch {
      toast.error(t("addError"));
    } finally {
      setIsAddingPasskey(false);
    }
  }

  const handleDeletePasskey = async (id: string) => {
    setRemovingPasskeyId(id);

    try {
      const result = await authClient.passkey.deletePasskey({
        id,
      });

      if (result.error) {
        toast.error(getPasskeyErrorMessage(t("deleteError"), result.error));
        return;
      }

      if (!(await reloadPasskeys({ showLoadingState: false }))) {
        toast.error(t("refreshError"));
        return;
      }

      router.refresh();
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteError"));
    } finally {
      setRemovingPasskeyId(null);
    }
  };

  const handleEditPasskey = (id: string, name?: null | string) => {
    setEditingPasskeyId(id);
    setPasskeyNameDraft(name ?? "");
  };

  const handleCancelEditPasskey = () => {
    setEditingPasskeyId(null);
    setPasskeyNameDraft("");
  };

  const handleSavePasskey = async (id: string) => {
    setSavingPasskeyId(id);

    try {
      const result = await authClient.passkey.updatePasskey({
        id,
        name: passkeyNameDraft.trim(),
      });

      if (result.error) {
        toast.error(getPasskeyErrorMessage(t("renameError"), result.error));
        return;
      }

      handleCancelEditPasskey();
      if (!(await reloadPasskeys({ showLoadingState: false }))) {
        toast.error(t("refreshError"));
        return;
      }

      router.refresh();
      toast.success(t("renameSuccess"));
    } catch {
      toast.error(t("renameError"));
    } finally {
      setSavingPasskeyId(null);
    }
  };

  function handlePasskeyEditSubmit(
    event: FormEvent<HTMLFormElement>,
    id: string,
  ) {
    event.preventDefault();

    if (isMutatingPasskeys) {
      return;
    }

    void handleSavePasskey(id);
  }

  const loadErrorNotice = (
    <div className="rounded-lg border border-dashed px-4 py-3">
      <p className="text-sm">{t("loadError")}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        disabled={isLoadingPasskeys || isMutatingPasskeys}
        onClick={() => {
          void reloadPasskeys();
        }}
      >
        {t("retry")}
      </Button>
    </div>
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingPasskeys ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
            {t("loading")}
          </div>
        ) : hasPasskeyLoadError && sortedPasskeys.length === 0 ? (
          loadErrorNotice
        ) : sortedPasskeys.length > 0 ? (
          <>
            {hasPasskeyLoadError && loadErrorNotice}
            <div className="flex flex-col divide-y rounded-lg border">
              {sortedPasskeys.map((passkey) => (
                <div key={passkey.id} className="px-4 py-3">
                  {editingPasskeyId === passkey.id ? (
                    <form
                      className="flex items-center justify-between gap-4"
                      onSubmit={(event) => {
                        handlePasskeyEditSubmit(event, passkey.id);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <Input
                          value={passkeyNameDraft}
                          aria-label={t("editInputLabel")}
                          disabled={isMutatingPasskeys}
                          className="h-9"
                          onChange={(event) => {
                            setPasskeyNameDraft(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Escape" || isMutatingPasskeys) {
                              return;
                            }

                            event.preventDefault();
                            handleCancelEditPasskey();
                          }}
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isMutatingPasskeys}
                          aria-label={t("cancel")}
                          onClick={handleCancelEditPasskey}
                        >
                          <X className="size-4" />
                        </Button>
                        <Button
                          type="submit"
                          size="icon"
                          disabled={isMutatingPasskeys}
                          loading={savingPasskeyId === passkey.id}
                          aria-label={t("save")}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {passkey.name || t("defaultName")}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t("createdAt", {
                            date: formatter.dateTime(
                              new Date(passkey.createdAt),
                              "dateTimeMedium",
                            ),
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isMutatingPasskeys}
                          aria-label={t("editAriaLabel", {
                            name: passkey.name || t("defaultName"),
                          })}
                          onClick={() => {
                            handleEditPasskey(passkey.id, passkey.name);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isMutatingPasskeys}
                          loading={removingPasskeyId === passkey.id}
                          aria-label={t("deleteAriaLabel", {
                            name: passkey.name || t("defaultName"),
                          })}
                          onClick={() => {
                            void handleDeletePasskey(passkey.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        {canAddPasskey ? null : (
          <p className="text-muted-foreground text-sm">{t("addUnavailable")}</p>
        )}
        <Button
          type="button"
          className="ms-auto"
          disabled={!canAddPasskey || isLoadingPasskeys || isMutatingPasskeys}
          loading={isAddingPasskey}
          onClick={() => {
            void handleAddPasskey();
          }}
        >
          {t("add")}
        </Button>
      </CardFooter>
      <ReauthDialog {...reauthGate.dialogProps} />
    </Card>
  );
}
