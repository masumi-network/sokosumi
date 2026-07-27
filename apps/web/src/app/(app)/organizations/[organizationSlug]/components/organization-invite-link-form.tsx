"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganizationInviteLink } from "@/lib/actions/organization/invite-link-action";

const COPIED_RESET_MS = 2000;
const DEFAULT_EXPIRES_IN_DAYS = 7;
const MIN_EXPIRES_IN_DAYS = 1;
const MAX_EXPIRES_IN_DAYS = 90;
const MIN_MAX_USES = 1;
const MAX_MAX_USES = 10000;

interface OrganizationInviteLinkFormProps {
  organizationId: string;
}

export function OrganizationInviteLinkForm({
  organizationId,
}: OrganizationInviteLinkFormProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.InviteLinks.Form",
  );
  const router = useRouter();
  const [expiresInDays, setExpiresInDays] = useState(
    String(DEFAULT_EXPIRES_IN_DAYS),
  );
  const [unlimitedUses, setUnlimitedUses] = useState(true);
  const [maxUses, setMaxUses] = useState(String(MIN_MAX_USES));
  const [loading, setLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleCopyCreatedLink = useCallback(
    async (url: string) => {
      try {
        await navigator.clipboard.writeText(url);
        setCopiedUrl(url);
        setTimeout(() => setCopiedUrl(null), COPIED_RESET_MS);
      } catch {
        toast.error(t("copyError"));
      }
    },
    [t],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedExpiresInDays = Number.parseInt(expiresInDays, 10);
    if (
      !Number.isInteger(parsedExpiresInDays) ||
      parsedExpiresInDays < MIN_EXPIRES_IN_DAYS ||
      parsedExpiresInDays > MAX_EXPIRES_IN_DAYS
    ) {
      toast.error(t("expiresInDaysError"));
      return;
    }

    let parsedMaxUses: number | null = null;
    if (!unlimitedUses) {
      const value = Number.parseInt(maxUses, 10);
      if (
        !Number.isInteger(value) ||
        value < MIN_MAX_USES ||
        value > MAX_MAX_USES
      ) {
        toast.error(t("maxUsesError"));
        return;
      }
      parsedMaxUses = value;
    }

    setLoading(true);
    try {
      const result = await createOrganizationInviteLink({
        organizationId,
        expiresInDays: parsedExpiresInDays,
        maxUses: parsedMaxUses,
      });

      if (!result.ok) {
        toast.error(result.error?.message ?? t("error"));
        return;
      }

      toast.success(t("success"));
      await handleCopyCreatedLink(result.data.url);
      router.refresh();
    } catch {
      toast.error(t("error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-lg border p-6"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-link-expires-in-days">
            {t("expiresInDaysLabel")}
          </Label>
          <Input
            id="invite-link-expires-in-days"
            type="number"
            min={MIN_EXPIRES_IN_DAYS}
            max={MAX_EXPIRES_IN_DAYS}
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
            disabled={loading}
            required
          />
          <p className="text-muted-foreground text-xs">
            {t("expiresInDaysHint")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-link-max-uses">{t("maxUsesLabel")}</Label>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={unlimitedUses}
                onChange={(event) => setUnlimitedUses(event.target.checked)}
                disabled={loading}
              />
              <span>{t("unlimitedUses")}</span>
            </label>
            {!unlimitedUses ? (
              <Input
                id="invite-link-max-uses"
                type="number"
                min={MIN_MAX_USES}
                max={MAX_MAX_USES}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                disabled={loading}
                required
              />
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{t("maxUsesHint")}</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {copiedUrl ? (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Check className="size-3.5" />
            {t("copied")}
          </span>
        ) : null}
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
