"use client";

import type { SokoBotMcpServer } from "@sokosumi/core-client";
import { ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  addSokoBotMcpServerAction,
  refreshSokoBotMcpServerAction,
  removeSokoBotMcpServerAction,
  signInToSokoBotMcpServerAction,
  updateSokoBotMcpToolAction,
} from "@/lib/actions/soko-bot/tools-action";

type AuthType = "none" | "bearer" | "header" | "oauth";

/**
 * The remote MCP servers the owner added to their bot (ADR 0074): add one by
 * its address, see its tools, switch each on or off, mark what it does.
 */
export function McpServersSection({
  botId,
  initialServers,
}: {
  botId: string;
  initialServers: SokoBotMcpServer[];
}) {
  const t = useTranslations("App.SokoBot.Mcp");
  const [servers, setServers] = useState(initialServers);
  const [adding, setAdding] = useState(initialServers.length === 0);
  const [isPending, startTransition] = useTransition();

  function replace(server: SokoBotMcpServer) {
    setServers((current) =>
      current.map((entry) => (entry.id === server.id ? server : entry)),
    );
  }

  function refresh(server: SokoBotMcpServer) {
    startTransition(async () => {
      const result = await refreshSokoBotMcpServerAction({
        input: { botId, serverId: server.id },
      }).catch(() => null);
      if (result?.ok) {
        replace(result.value);
        toast.success(t("refreshed", { name: server.name }));
      } else toast.error(result?.error.message ?? t("refreshError"));
    });
  }

  function signIn(server: SokoBotMcpServer) {
    startTransition(async () => {
      const result = await signInToSokoBotMcpServerAction({
        input: { botId, serverId: server.id },
      }).catch(() => null);
      if (result?.ok && result.value) window.location.assign(result.value);
      else if (result?.ok) refresh(server);
      else toast.error(result?.error.message ?? t("signInError"));
    });
  }

  function remove(server: SokoBotMcpServer) {
    startTransition(async () => {
      const result = await removeSokoBotMcpServerAction({
        input: { botId, serverId: server.id },
      }).catch(() => null);
      if (result?.ok)
        setServers((current) => current.filter((s) => s.id !== server.id));
      else toast.error(result?.error.message ?? t("removeError"));
    });
  }

  function changeTool(
    server: SokoBotMcpServer,
    name: string,
    change: { enabled?: boolean; readOnly?: boolean },
  ) {
    startTransition(async () => {
      const result = await updateSokoBotMcpToolAction({
        input: { botId, serverId: server.id, name, ...change },
      }).catch(() => null);
      if (result?.ok) replace(result.value);
      else toast.error(result?.error.message ?? t("toolError"));
    });
  }

  return (
    <div className="space-y-4">
      {servers.length > 0 ? (
        <ul className="space-y-2">
          {servers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              pending={isPending}
              onRefresh={() => refresh(server)}
              onSignIn={() => signIn(server)}
              onRemove={() => remove(server)}
              onChangeTool={(name, change) => changeTool(server, name, change)}
            />
          ))}
        </ul>
      ) : null}
      <div>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
          className="text-muted-foreground press hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <Plus aria-hidden className="size-3.5" />
          {t("addTitle")}
        </button>
        {adding ? (
          <AddMcpServerForm
            botId={botId}
            onAdded={(server) => {
              setServers((current) => [...current, server]);
              setAdding(false);
              toast.success(t("added", { name: server.name }));
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function McpServerRow({
  server,
  pending,
  onRefresh,
  onSignIn,
  onRemove,
  onChangeTool,
}: {
  server: SokoBotMcpServer;
  pending: boolean;
  onRefresh: () => void;
  onSignIn: () => void;
  onRemove: () => void;
  onChangeTool: (
    name: string,
    change: { enabled?: boolean; readOnly?: boolean },
  ) => void;
}) {
  const t = useTranslations("App.SokoBot.Mcp");
  const [open, setOpen] = useState(false);
  const enabled = server.tools.filter((tool) => tool.enabled).length;
  return (
    <li className="rounded-lg border text-sm">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="press flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={`text-muted-foreground size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{server.name}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {server.url}
            </span>
          </span>
        </button>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {t("toolCount", { enabled, total: server.tools.length })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hit-area size-7"
          aria-label={t("refresh", { name: server.name })}
          disabled={pending}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hit-area -mr-1.5 size-7"
          aria-label={t("remove", { name: server.name })}
          disabled={pending}
          onClick={onRemove}
        >
          <Trash2 aria-hidden className="size-3.5" />
        </Button>
      </div>
      {server.lastError ? (
        <p className="text-destructive border-t px-3 py-2 text-xs">
          {server.lastError}
        </p>
      ) : null}
      {/* Added with OAuth, but the owner has not finished signing in. */}
      {server.authKind === "oauth" &&
      (server.toolsRefreshedAt === null || server.lastError) ? (
        <div className="flex items-center gap-3 border-t px-3 py-2">
          <p className="text-muted-foreground flex-1 text-xs">
            {t("signInNeeded")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={pending}
            onClick={onSignIn}
          >
            {t("signIn")}
          </Button>
        </div>
      ) : null}
      {open ? (
        <ul className="divide-y border-t">
          {server.tools.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{tool.name}</p>
                {tool.description ? (
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {tool.description}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Select
                  value={tool.readOnly ? "reads" : "changes"}
                  onValueChange={(value) =>
                    onChangeTool(tool.name, { readOnly: value === "reads" })
                  }
                  disabled={pending}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-40"
                    aria-label={t("kindLabel", { name: tool.name })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reads">{t("reads")}</SelectItem>
                    <SelectItem value="changes">{t("changes")}</SelectItem>
                  </SelectContent>
                </Select>
                <Switch
                  checked={tool.enabled}
                  disabled={pending}
                  aria-label={t("enabledLabel", { name: tool.name })}
                  onCheckedChange={(checked) =>
                    onChangeTool(tool.name, { enabled: checked })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function AddMcpServerForm({
  botId,
  onAdded,
}: {
  botId: string;
  onAdded: (server: SokoBotMcpServer) => void;
}) {
  const t = useTranslations("App.SokoBot.Mcp");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("oauth");
  const [headerName, setHeaderName] = useState("");
  const [secret, setSecret] = useState("");
  const [isPending, startTransition] = useTransition();
  const ready =
    name.trim() &&
    url.trim() &&
    (authType === "none" ||
      authType === "oauth" ||
      (secret.trim() && (authType === "bearer" || headerName.trim())));

  function submit() {
    const auth =
      authType === "none" || authType === "oauth"
        ? { type: authType }
        : authType === "bearer"
          ? { type: "bearer" as const, token: secret.trim() }
          : { type: "header" as const, name: headerName.trim(), value: secret };
    startTransition(async () => {
      const result = await addSokoBotMcpServerAction({
        input: { botId, name: name.trim(), url: url.trim(), auth },
      }).catch(() => null);
      if (result?.ok && result.value.authorizationUrl)
        window.location.assign(result.value.authorizationUrl);
      else if (result?.ok) {
        setSecret("");
        onAdded(result.value);
      } else toast.error(result?.error.message ?? t("addError"));
    });
  }

  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="mcp-name">{t("nameLabel")}</Label>
        <Input
          id="mcp-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mcp-url">{t("urlLabel")}</Label>
        <Input
          id="mcp-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mcp-auth">{t("authLabel")}</Label>
        <Select
          value={authType}
          onValueChange={(value) => setAuthType(value as AuthType)}
        >
          <SelectTrigger id="mcp-auth" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="oauth">{t("authOauth")}</SelectItem>
            <SelectItem value="bearer">{t("authBearer")}</SelectItem>
            <SelectItem value="header">{t("authHeader")}</SelectItem>
            <SelectItem value="none">{t("authNone")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {authType === "none" || authType === "oauth" ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="mcp-secret">{t("keyLabel")}</Label>
          <div className="flex gap-2">
            {authType === "header" ? (
              <Input
                aria-label={t("headerNameLabel")}
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
                placeholder="X-API-Key"
                autoComplete="off"
                className="w-36 shrink-0"
              />
            ) : null}
            <Input
              id="mcp-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" loading={isPending} disabled={!ready}>
          {t("connect")}
        </Button>
        <p className="text-muted-foreground text-xs">{t("addHelp")}</p>
      </div>
    </form>
  );
}
