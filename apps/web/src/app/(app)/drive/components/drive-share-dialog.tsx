"use client";

import type { DriveShare } from "@sokosumi/core-client";
import { Check, Copy, Link2, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useClipboard } from "@/hooks/use-clipboard";
import {
  type DriveShareTarget,
  driveShareUrl,
  type FileStore,
  fetchDriveShare,
  revokeDriveShare,
  saveDriveShare,
} from "@/lib/utils/file-search.client";

export interface DriveShareItem {
  target: DriveShareTarget;
  name: string;
}

/** Link + optional password for one Drive file or folder. */
export function DriveShareDialog({
  store,
  item,
  onOpenChange,
}: {
  store: FileStore;
  item: DriveShareItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("App.Drive.Share");
  const passwordId = useId();
  const [share, setShare] = useState<DriveShare | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Read through a ref so a new `t` never refetches the link.
  const loadFailedMessage = useRef(t("loadFailed"));
  loadFailedMessage.current = t("loadFailed");
  const { copied, copy } = useClipboard({
    copySuccessMessage: t("copied"),
    copyErrorMessage: t("copyFailed"),
  });

  useEffect(() => {
    if (!item) return;
    let current = true;
    setShare(undefined);
    setPassword("");
    fetchDriveShare({ store, target: item.target })
      .then((found) => {
        if (current) setShare(found);
      })
      .catch(() => {
        if (current) setShare(null);
        toast.error(loadFailedMessage.current);
      });
    return () => {
      current = false;
    };
  }, [item, store]);

  async function run(action: () => Promise<DriveShare | null>, done: string) {
    setBusy(true);
    try {
      setShare(await action());
      setPassword("");
      toast.success(done);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const target = item?.target;
  const url = share ? driveShareUrl(share.token) : "";
  const passwordValid = password.length >= 4;

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { name: item?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {target?.kind === "folder"
              ? t("folderDescription")
              : t("fileDescription")}
          </DialogDescription>
        </DialogHeader>

        {share === undefined ? (
          <div className="grid gap-3" role="status">
            <span className="sr-only">{t("loading")}</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : share === null ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!target || (password && !passwordValid)) return;
              void run(
                () =>
                  saveDriveShare({
                    store,
                    target,
                    password: password || undefined,
                  }),
                t("created"),
              );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={passwordId}>{t("passwordOptional")}</Label>
              <Input
                id={passwordId}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("passwordPlaceholder")}
              />
              {password && !passwordValid ? (
                <p className="text-muted-foreground text-xs">
                  {t("passwordTooShort")}
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              loading={busy}
              disabled={Boolean(password) && !passwordValid}
            >
              <Link2 aria-hidden className="size-4" />
              {t("create")}
            </Button>
          </form>
        ) : (
          <div className="grid gap-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label={t("linkLabel")}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void copy(url)}
              >
                {copied ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <Copy aria-hidden className="size-4" />
                )}
                {t("copy")}
              </Button>
            </div>

            <form
              className="grid gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!target || !passwordValid) return;
                void run(
                  () => saveDriveShare({ store, target, password }),
                  t("passwordSaved"),
                );
              }}
            >
              <Label htmlFor={passwordId} className="flex items-center gap-1.5">
                <Lock aria-hidden className="size-3.5" />
                {share.hasPassword ? t("passwordOn") : t("passwordOff")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={
                    share.hasPassword
                      ? t("newPasswordPlaceholder")
                      : t("passwordPlaceholder")
                  }
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="shrink-0"
                  disabled={!passwordValid || busy}
                >
                  {share.hasPassword ? t("changePassword") : t("setPassword")}
                </Button>
              </div>
              {password && !passwordValid ? (
                <p className="text-muted-foreground text-xs">
                  {t("passwordTooShort")}
                </p>
              ) : null}
              {share.hasPassword ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-self-start"
                  disabled={busy}
                  onClick={() =>
                    target &&
                    void run(
                      () => saveDriveShare({ store, target, password: null }),
                      t("passwordRemoved"),
                    )
                  }
                >
                  {t("removePassword")}
                </Button>
              ) : null}
            </form>

            <Button
              type="button"
              variant="ghost"
              className="text-semantic-destructive justify-self-start"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await revokeDriveShare({ store, shareId: share.id });
                  return null;
                }, t("revoked"))
              }
            >
              {t("revoke")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
