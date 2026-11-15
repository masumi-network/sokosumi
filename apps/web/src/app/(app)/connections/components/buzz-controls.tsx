"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { BUZZ_ACTION_STYLE } from "@/components/buzz/buzz-brand";
import { BuzzConnectDialog } from "@/components/buzz/buzz-connect-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  enableBuzzForOrganization,
  setBuzzPersonalAgents,
  unlinkBuzzApp,
} from "@/lib/actions/buzz/action";

/**
 * A read-only value people copy, such as a relay address or a public key: the
 * whole value in mono on one control, which copies it and says so.
 */
export function BuzzCopyField({
  label,
  value,
  hint,
  copyLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Names what the button copies, for screen readers. */
  copyLabel?: string;
}) {
  const t = useTranslations("App.Connections.Buzz");
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <button
        type="button"
        aria-label={copyLabel ?? `${t("copy")} ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(t("copied"));
          setTimeout(() => setCopied(false), 1500);
        }}
        className="bg-background hover:bg-quinary group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1 font-mono text-sm break-all">
          {value}
        </span>
        <span className="text-muted-foreground group-hover:text-foreground flex shrink-0 items-center gap-1 text-xs font-medium">
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          {copied ? t("copied") : t("copy")}
        </span>
      </button>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
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

/** Opens the Connect Buzz dialog. */
export function BuzzConnectButton({
  variant = "primary",
  label,
  resume = false,
}: {
  variant?: "primary" | "outline";
  label: string;
  /** Opens at the Authorize step. */
  resume?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        className="rounded-full px-4"
        // The first connect is Buzz's own action: an ink pill.
        style={variant === "primary" ? BUZZ_ACTION_STYLE : undefined}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <BuzzConnectDialog open={open} onOpenChange={setOpen} resume={resume} />
    </>
  );
}

/** Forgets the person's linked Buzz identity (and its agents here). */
export function BuzzUnlinkButton() {
  const t = useTranslations("App.Connections.Buzz");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
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
  );
}

/**
 * Whether members may bring their personal agents into this organization's
 * rooms without approval. Owners and admins change it; others see it.
 */
export function BuzzPersonalAgentsSwitch({
  organizationId,
  allowed,
  canManage,
}: {
  organizationId: string;
  allowed: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("App.Connections.Buzz");
  const router = useRouter();
  const [checked, setChecked] = useState(allowed);
  const [saving, setSaving] = useState(false);
  const id = `buzz-personal-agents-${organizationId}`;
  return (
    <div className="flex items-start justify-between gap-3 border-t pt-3">
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium">
          {t("personalAgentsTitle")}
        </label>
        <p className="text-muted-foreground text-xs">
          {checked ? t("personalAgentsOn") : t("personalAgentsOff")}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={!canManage || saving}
        onCheckedChange={async (next) => {
          setChecked(next);
          setSaving(true);
          const result = await setBuzzPersonalAgents({
            organizationId,
            allowPersonalAgents: next,
          });
          setSaving(false);
          if (result.ok) {
            router.refresh();
          } else {
            setChecked(!next);
            toast.error(result.error.message);
          }
        }}
      />
    </div>
  );
}
