"use client";

import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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

export function PasskeySettings() {
  const t = useTranslations("App.Account.Passkeys");
  const locale = useLocale();
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<
    Array<{
      createdAt: Date | string;
      id: string;
      name?: string | null;
    }>
  >([]);
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(true);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [passkeyNameDraft, setPasskeyNameDraft] = useState("");
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(
    null,
  );
  const [savingPasskeyId, setSavingPasskeyId] = useState<string | null>(null);

  const reloadPasskeys = async () => {
    setIsLoadingPasskeys(true);

    const result = await authClient.passkey.listUserPasskeys();

    if (result.error) {
      setIsLoadingPasskeys(false);
      return;
    }

    setPasskeys(result.data ?? []);
    setIsLoadingPasskeys(false);
  };

  useEffect(() => {
    let isActive = true;

    void authClient.passkey.listUserPasskeys().then((result) => {
      if (!isActive) {
        return;
      }

      if (result.error) {
        setIsLoadingPasskeys(false);
        return;
      }

      setPasskeys(result.data ?? []);
      setIsLoadingPasskeys(false);
    });

    return () => {
      isActive = false;
    };
  }, [t]);

  const sortedPasskeys = useMemo(() => {
    return [...passkeys].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }, [passkeys]);

  const handleAddPasskey = async () => {
    setIsAddingPasskey(true);

    const result = await authClient.passkey.addPasskey();

    setIsAddingPasskey(false);

    if (result.error) {
      toast.error(getPasskeyErrorMessage(t("addError"), result.error));
      return;
    }

    await reloadPasskeys();
    router.refresh();
    toast.success(t("addSuccess"));
  };

  const handleDeletePasskey = async (id: string) => {
    setRemovingPasskeyId(id);

    const result = await authClient.passkey.deletePasskey({
      id,
    });

    setRemovingPasskeyId(null);

    if (result.error) {
      toast.error(getPasskeyErrorMessage(t("deleteError"), result.error));
      return;
    }

    await reloadPasskeys();
    router.refresh();
    toast.success(t("deleteSuccess"));
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

    const result = await authClient.passkey.updatePasskey({
      id,
      name: passkeyNameDraft.trim(),
    });

    setSavingPasskeyId(null);

    if (result.error) {
      toast.error(getPasskeyErrorMessage(t("renameError"), result.error));
      return;
    }

    handleCancelEditPasskey();
    await reloadPasskeys();
    router.refresh();
    toast.success(t("renameSuccess"));
  };

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
        ) : sortedPasskeys.length > 0 ? (
          <div className="flex flex-col divide-y rounded-lg border">
            {sortedPasskeys.map((passkey) => (
              <div key={passkey.id} className="px-4 py-3">
                {editingPasskeyId === passkey.id ? (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <Input
                        value={passkeyNameDraft}
                        aria-label={t("editInputLabel")}
                        disabled={savingPasskeyId === passkey.id}
                        className="h-9"
                        onChange={(event) => {
                          setPasskeyNameDraft(event.target.value);
                        }}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={savingPasskeyId === passkey.id}
                        aria-label={t("cancel")}
                        onClick={handleCancelEditPasskey}
                      >
                        <X className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        disabled={savingPasskeyId === passkey.id}
                        aria-label={t("save")}
                        onClick={() => {
                          void handleSavePasskey(passkey.id);
                        }}
                      >
                        {savingPasskeyId === passkey.id && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {savingPasskeyId !== passkey.id && (
                          <Check className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
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
                        disabled={
                          removingPasskeyId === passkey.id ||
                          savingPasskeyId === passkey.id
                        }
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
                        disabled={
                          removingPasskeyId === passkey.id ||
                          savingPasskeyId === passkey.id
                        }
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
        ) : (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={isAddingPasskey}
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
