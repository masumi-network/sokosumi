"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  enableBuzzForOrganization,
  revealBuzzSecretKey,
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
