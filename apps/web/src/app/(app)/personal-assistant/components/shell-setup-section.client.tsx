"use client";

import type { SokoBotSecret } from "@sokosumi/core-client";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteSokoBotSecretAction,
  saveSokoBotSecretAction,
  setSokoBotSandboxSetupAction,
} from "@/lib/actions/soko-bot/tools-action";

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Command-line tools for the bot's sandbox (ADR 0074): commands that run
 * each time it starts, and keys its shell commands may use. A key's value is
 * write-only: the page shows its name and nothing else.
 */
export function ShellSetupSection({
  botId,
  initialCommands,
  initialSecrets,
}: {
  botId: string;
  initialCommands: string[];
  initialSecrets: SokoBotSecret[];
}) {
  const t = useTranslations("App.SokoBot.Shell");
  return (
    <div className="space-y-6">
      <SetupCommands botId={botId} initial={initialCommands} />
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("keysTitle")}</p>
          <p className="text-muted-foreground text-xs text-pretty">
            {t("keysHelp")}
          </p>
        </div>
        <Keys botId={botId} initial={initialSecrets} />
      </div>
    </div>
  );
}

function SetupCommands({
  botId,
  initial,
}: {
  botId: string;
  initial: string[];
}) {
  const t = useTranslations("App.SokoBot.Shell");
  const [text, setText] = useState(initial.join("\n"));
  const [saved, setSaved] = useState(initial.join("\n"));
  const [isPending, startTransition] = useTransition();
  const commands = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  function save() {
    startTransition(async () => {
      const result = await setSokoBotSandboxSetupAction({
        input: { botId, commands },
      }).catch(() => null);
      if (result?.ok) {
        const next = result.value.join("\n");
        setText(next);
        setSaved(next);
        toast.success(t("commandsSaved"));
      } else toast.error(result?.error.message ?? t("commandsError"));
    });
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="shell-setup">{t("commandsTitle")}</Label>
        <p className="text-muted-foreground text-xs text-pretty">
          {t("commandsHelp")}
        </p>
      </div>
      <Textarea
        id="shell-setup"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="npm install -g vercel"
        rows={3}
        spellCheck={false}
        className="font-mono text-xs"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        loading={isPending}
        disabled={text === saved || commands.length > 10}
      >
        {t("saveCommands")}
      </Button>
    </form>
  );
}

function Keys({ botId, initial }: { botId: string; initial: SokoBotSecret[] }) {
  const t = useTranslations("App.SokoBot.Shell");
  const [secrets, setSecrets] = useState(initial);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const validName = SECRET_NAME.test(name);

  function upsert(secret: SokoBotSecret) {
    setSecrets((current) =>
      [...current.filter((entry) => entry.name !== secret.name), secret].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    );
  }

  function add() {
    startTransition(async () => {
      const result = await saveSokoBotSecretAction({
        input: { botId, name, value, shellAccess: true },
      }).catch(() => null);
      if (result?.ok) {
        upsert(result.value);
        setName("");
        setValue("");
        toast.success(t("keySaved", { name: result.value.name }));
      } else toast.error(result?.error.message ?? t("keyError"));
    });
  }

  function toggle(secret: SokoBotSecret, shellAccess: boolean) {
    startTransition(async () => {
      const result = await saveSokoBotSecretAction({
        input: { botId, name: secret.name, shellAccess },
      }).catch(() => null);
      if (result?.ok) upsert(result.value);
      else toast.error(result?.error.message ?? t("keyError"));
    });
  }

  function remove(secret: SokoBotSecret) {
    startTransition(async () => {
      const result = await deleteSokoBotSecretAction({
        input: { botId, name: secret.name },
      }).catch(() => null);
      if (result?.ok)
        setSecrets((current) => current.filter((s) => s.id !== secret.id));
      else toast.error(result?.error.message ?? t("keyError"));
    });
  }

  return (
    <div className="space-y-3">
      {secrets.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {secrets.map((secret) => (
            <li
              key={secret.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {secret.name}
              </span>
              <span className="text-muted-foreground hidden text-xs sm:inline">
                {t("shellAccess")}
              </span>
              <Switch
                checked={secret.shellAccess}
                disabled={isPending}
                aria-label={t("shellAccessLabel", { name: secret.name })}
                onCheckedChange={(checked) => toggle(secret, checked)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hit-area -mr-1.5 size-7"
                aria-label={t("deleteKey", { name: secret.name })}
                disabled={isPending}
                onClick={() => remove(secret)}
              >
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (validName && value) add();
        }}
      >
        <Input
          aria-label={t("keyNameLabel")}
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase())}
          placeholder="VERCEL_TOKEN"
          autoComplete="off"
          spellCheck={false}
          className="font-mono sm:w-56"
        />
        <Input
          aria-label={t("keyValueLabel")}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("keyValuePlaceholder")}
          autoComplete="off"
        />
        <Button
          type="submit"
          size="sm"
          loading={isPending}
          disabled={!validName || !value}
          className="shrink-0"
        >
          <Plus aria-hidden className="size-3.5" />
          {t("addKey")}
        </Button>
      </form>
    </div>
  );
}
