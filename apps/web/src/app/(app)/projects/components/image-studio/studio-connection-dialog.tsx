import type { StudioConnection } from "@sokosumi/core-client";
import { Copy, Plug } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { McpUrlDisplay } from "@/app/components/MCP/mcp-url-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyTextWithToast } from "@/hooks/use-clipboard";
import {
  createStudioConnection,
  getStudioConnection,
  revokeStudioConnection,
} from "@/lib/actions/image-studio/connection";

type Operation = "load" | "create" | "revoke";

export function StudioConnectionDialog({ projectId }: { projectId: string }) {
  const t = useTranslations("App.Studio.Connection");
  const format = useFormatter();
  const tokenId = useId();
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<
    (StudioConnection & { token?: string }) | null
  >(null);
  const [showToken, setShowToken] = useState(false);
  const [pending, setPending] = useState<Operation | null>(null);
  const [error, setError] = useState<Operation | null>(null);
  const expiresAt = connection?.expiresAt;
  const token = connection?.token;

  useEffect(() => {
    if (!open || !expiresAt) return;
    const timeout = setTimeout(
      () => {
        setConnection((current) =>
          current?.expiresAt === expiresAt
            ? { url: current.url, expiresAt: null }
            : current,
        );
      },
      Math.max(0, expiresAt.getTime() - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [open, expiresAt]);

  async function run(operation: Operation, action: () => Promise<void>) {
    if (pending) return;
    setPending(operation);
    setError(null);
    try {
      await action();
    } catch {
      setError(operation);
    } finally {
      setPending(null);
    }
  }

  function load() {
    return run("load", async () => {
      setConnection(await getStudioConnection({ projectId }));
    });
  }

  function create() {
    return run("create", async () => {
      setShowToken(false);
      setConnection((current) => current && { ...current, token: undefined });
      setConnection(await createStudioConnection({ projectId }));
    });
  }

  function revoke() {
    return run("revoke", async () => {
      await revokeStudioConnection({ projectId });
      setConnection(
        (current) => current && { url: current.url, expiresAt: null },
      );
      setShowToken(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        setConnection(null);
        setShowToken(false);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <Plug aria-hidden />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {pending === "load" ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("loading")}
          </p>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {t(`${error}Error`)}
          </p>
        ) : null}
        {connection ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t("readOnly")}</Badge>
              <p className="text-muted-foreground text-sm" role="status">
                {expiresAt
                  ? t("expires", {
                      time: format.dateTime(expiresAt, "dateTime"),
                    })
                  : t("inactive")}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("serverUrl")}</p>
              <McpUrlDisplay url={connection.url} />
              <p className="text-muted-foreground text-sm">{t("setup")}</p>
            </div>
            {token ? (
              <div className="space-y-2">
                <Label htmlFor={tokenId}>{t("token")}</Label>
                <Input
                  autoComplete="off"
                  className="font-mono"
                  id={tokenId}
                  readOnly
                  spellCheck={false}
                  type={showToken ? "text" : "password"}
                  value={token}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!!pending}
                    onClick={() =>
                      void copyTextWithToast(token, {
                        copySuccessMessage: t("tokenCopied"),
                        copyErrorMessage: t("tokenCopyError"),
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Copy aria-hidden />
                    {t("copyToken")}
                  </Button>
                  <Button
                    disabled={!!pending}
                    onClick={() => setShowToken((current) => !current)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t(showToken ? "hideToken" : "showToken")}
                  </Button>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("tokenOnce")}
                </p>
              </div>
            ) : null}
            {expiresAt ? (
              <p className="text-muted-foreground text-sm">
                {t("replacement")}
              </p>
            ) : null}
            <DialogFooter>
              {expiresAt ? (
                <Button
                  disabled={pending === "create"}
                  loading={pending === "revoke"}
                  onClick={revoke}
                  type="button"
                  variant="outline"
                >
                  {t("disconnect")}
                </Button>
              ) : null}
              <Button
                disabled={pending === "revoke"}
                loading={pending === "create"}
                onClick={create}
                type="button"
              >
                {t(expiresAt ? "newToken" : "createToken")}
              </Button>
            </DialogFooter>
          </>
        ) : error === "load" ? (
          <DialogFooter>
            <Button onClick={load} type="button">
              {t("retry")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
