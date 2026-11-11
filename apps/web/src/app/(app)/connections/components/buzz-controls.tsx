"use client";

import type { BuzzAppKeyInvites, BuzzConnection } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  enableBuzzForOrganization,
  linkBuzzApp,
  revealBuzzSecretKey,
  unlinkBuzzApp,
} from "@/lib/actions/buzz/action";

async function copy(value: string, copied: string) {
  await navigator.clipboard.writeText(value);
  toast.success(copied);
}

/** A read-only value with a copy button: the relay address or the public key. */
export function BuzzCopyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const t = useTranslations("App.Connections.Buzz");
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          readOnly
          aria-label={label}
          className="min-w-0 flex-1 font-mono text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy(value, t("copied"))}
        >
          {t("copy")}
        </Button>
      </div>
    </div>
  );
}

/** Reveals the secret key on request, to import into a Buzz client. */
export function BuzzSecretKey() {
  const t = useTranslations("App.Connections.Buzz");
  const [nsec, setNsec] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (nsec) {
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs font-medium">
          {t("secretKey")}
        </p>
        <p className="text-muted-foreground text-xs">{t("secretKeyWarning")}</p>
        <div className="flex items-center gap-2">
          <Input
            value={nsec}
            readOnly
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            aria-label={t("secretKey")}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy(nsec, t("copied"))}
          >
            {t("copy")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNsec(null)}
          >
            {t("hide")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted-foreground text-xs">{t("secretKeyHint")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          const result = await revealBuzzSecretKey({});
          setLoading(false);
          if (result.ok) setNsec(result.value.nsec);
          else toast.error(result.error.message);
        }}
      >
        {t("reveal")}
      </Button>
    </div>
  );
}

/** Puts one organization's chats on Buzz. */
export function EnableBuzzButton({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("App.Connections.Buzz");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        const result = await enableBuzzForOrganization({ organizationId });
        setLoading(false);
        if (result.ok) {
          toast.success(t("enabled"));
          router.refresh();
        } else {
          toast.error(result.error.message);
        }
      }}
    >
      {t("enable")}
    </Button>
  );
}

/**
 * Links the person's own Buzz app: they paste its public key, open the invite
 * in Buzz, and the key is linked once Buzz has joined with it.
 */
export function BuzzAppLink({ app }: { app: BuzzConnection["app"] }) {
  const t = useTranslations("App.Connections.Buzz");
  const router = useRouter();
  const [publicKey, setPublicKey] = useState(app?.npub ?? "");
  const [invites, setInvites] = useState<BuzzAppKeyInvites["invites"]>([]);
  const [loading, setLoading] = useState(false);
  const pending = app?.status === "pending";

  // The worker or the next page load links the key; look again until then.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(timer);
  }, [pending, router]);

  if (app?.status === "linked") {
    return (
      <div className="space-y-3">
        <BuzzCopyField label={t("appLinked")} value={app.npub} />
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            {t("agentsTitle")}
          </p>
          {app.agents.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {app.agents.map((agent) => (
                <li key={agent.npub} className="flex items-center gap-2">
                  <span>{agent.name}</span>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {agent.npub.slice(0, 16)}…
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {app.agents.length > 0 ? t("agentsHint") : t("agentsEmpty")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={loading}
          onClick={async () => {
            setLoading(true);
            const result = await unlinkBuzzApp({});
            setLoading(false);
            if (result.ok) router.refresh();
            else toast.error(result.error.message);
          }}
        >
          {t("unlink")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form
        className="space-y-1"
        onSubmit={async (event) => {
          event.preventDefault();
          setLoading(true);
          const result = await linkBuzzApp({ publicKey });
          setLoading(false);
          if (result.ok) {
            setInvites(result.value.invites);
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        }}
      >
        <label
          htmlFor="buzz-app-public-key"
          className="text-muted-foreground text-xs font-medium"
        >
          {t("appPublicKey")}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="buzz-app-public-key"
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            placeholder="npub1…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          <Button type="submit" size="sm" loading={loading}>
            {pending && invites.length === 0 ? t("newInvite") : t("link")}
          </Button>
        </div>
      </form>
      {invites.map((invite) => (
        <div
          key={invite.relayUrl}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <p className="text-sm">{invite.organizationName}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copy(invite.inviteUrl, t("copied"))}
            >
              {t("copyInvite")}
            </Button>
            <Button asChild size="sm">
              <a href={invite.joinUrl}>{t("openInBuzz")}</a>
            </Button>
          </div>
        </div>
      ))}
      {pending && (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {invites.length > 0 ? t("waiting") : t("waitingNoInvite")}
        </p>
      )}
    </div>
  );
}
