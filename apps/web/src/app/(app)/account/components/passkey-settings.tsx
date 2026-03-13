"use client";

import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import type { BetterAuthClientError } from "@/lib/actions/errors/better-auth";
import { authClient } from "@/lib/auth/auth.client";

function formatPasskeyDate(date: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function getPasskeyErrorMessage(
  fallbackMessage: string,
  error: BetterAuthClientError | null,
): string {
  if (!error?.message) {
    return fallbackMessage;
  }

  return `${fallbackMessage}: ${error.message}`;
}

interface PasskeyRecord {
  createdAt: Date | string;
  id: string;
  name?: string | null;
}

export function PasskeySettings() {
  const t = useTranslations("App.Account.Passkeys");
  const locale = useLocale();
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [hasPasskeyLoadError, setHasPasskeyLoadError] = useState(false);
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(true);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [passkeyNameDraft, setPasskeyNameDraft] = useState("");
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(
    null,
  );
  const [savingPasskeyId, setSavingPasskeyId] = useState<string | null>(null);
  const isMutatingPasskeys =
    isAddingPasskey || removingPasskeyId !== null || savingPasskeyId !== null;

  const fetchPasskeys = useCallback(async (): Promise<null | PasskeyRecord[]> => {
    try {
      const result = await authClient.passkey.listUserPasskeys();

      if (result.error) {
        return null;
      }

      return result.data ?? [];
    } catch {
      return null;
    }
  }, []);

  const applyPasskeysResult = useCallback((nextPasskeys: null | PasskeyRecord[]) => {
    if (nextPasskeys === null) {
      setHasPasskeyLoadError(true);
      return false;
    }

    setPasskeys(nextPasskeys);
    setHasPasskeyLoadError(false);
    return true;
  }, []);

  const reloadPasskeys = useCallback(async () => {
    setIsLoadingPasskeys(true);

    try {
      const nextPasskeys = await fetchPasskeys();
      return applyPasskeysResult(nextPasskeys);
    } finally {
      setIsLoadingPasskeys(false);
    }
  }, [applyPasskeysResult, fetchPasskeys]);

  useEffect(() => {
    let isActive = true;

    void fetchPasskeys()
      .then((nextPasskeys) => {
        if (!isActive) {
          return;
        }

        applyPasskeysResult(nextPasskeys);
      })
      .finally(() => {
        if (!isActive) {
          return;
        }

        setIsLoadingPasskeys(false);
      });

    return () => {
      isActive = false;
    };
  }, [applyPasskeysResult, fetchPasskeys]);

  const sortedPasskeys = useMemo(() => {
    return [...passkeys].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }, [passkeys]);

  const handleAddPasskey = async () => {
    setIsAddingPasskey(true);

    try {
      const result = await authClient.passkey.addPasskey();

      if (result.error) {
        toast.error(getPasskeyErrorMessage(t("addError"), result.error));
        return;
      }

      if (!(await reloadPasskeys())) {
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
  };

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

      if (!(await reloadPasskeys())) {
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
      if (!(await reloadPasskeys())) {
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

  function handlePasskeyEditSubmit(event: FormEvent<HTMLFormElement>, id: string) {
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
            <Loader2 className="size-4 animate-spin" />
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
                          aria-label={t("save")}
                        >
                          {savingPasskeyId === passkey.id && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          {savingPasskeyId !== passkey.id && (
                            <Check className="size-4" />
                          )}
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
                            date: formatPasskeyDate(passkey.createdAt, locale),
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
                          aria-label={t("deleteAriaLabel", {
                            name: passkey.name || t("defaultName"),
                          })}
                          onClick={() => {
                            void handleDeletePasskey(passkey.id);
                          }}
                        >
                          {removingPasskeyId === passkey.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
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
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={isMutatingPasskeys}
          onClick={() => {
            void handleAddPasskey();
          }}
        >
          {isAddingPasskey && <Loader2 className="mr-2 size-4 animate-spin" />}
          {t("add")}
        </Button>
      </CardFooter>
    </Card>
  );
}
