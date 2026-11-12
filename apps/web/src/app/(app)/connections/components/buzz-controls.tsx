"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { BUZZ_ACTION_STYLE } from "@/components/buzz/buzz-brand";
import { BuzzConnectDialog } from "@/components/buzz/buzz-connect-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  enableBuzzForOrganization,
  setBuzzPersonalAgents,
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
