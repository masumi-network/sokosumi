"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  searchOrganizationsClient,
  searchUsersClient,
} from "@/lib/actions/admin-search/client";
import { grantSupportCreditsAction } from "@/lib/actions/support-credit-admin/action";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import type { AdminUserOption } from "@/lib/services/admin-user.service";
import type { SupportCreditTargetType } from "@/lib/services/support-credit-admin.service";

function parseOptionalPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function SupportCreditForm() {
  const t = useTranslations("App.Admin.SupportCredits");
  const tOrg = useTranslations("Components.OrganizationCombobox");
  const tUser = useTranslations("Components.UserCombobox");
  const router = useRouter();
  const [targetType, setTargetType] =
    useState<SupportCreditTargetType>("organization");
  const [selectedOrg, setSelectedOrg] =
    useState<AdminOrganizationOption | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserOption | null>(
    null,
  );
  const [creditsInput, setCreditsInput] = useState("");
  const [expiryDaysInput, setExpiryDaysInput] = useState("");
  const [referenceNoteInput, setReferenceNoteInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const orgLabels = buildComboboxLabels(tOrg);
  const userLabels = buildComboboxLabels(tUser);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetId = targetType === "user" ? selectedUser?.id : selectedOrg?.id;
    if (!targetId) {
      toast.error(t("Form.targetRequired"));
      return;
    }

    const credits = parseOptionalPositiveInteger(creditsInput);
    if (credits === null) {
      toast.error(t("Form.creditsRequired"));
      return;
    }

    const ttlDays = expiryDaysInput.trim()
      ? parseOptionalPositiveInteger(expiryDaysInput)
      : null;
    if (expiryDaysInput.trim() && ttlDays === null) {
      toast.error(t("Form.expiryInvalid"));
      return;
    }

    const referenceNote = referenceNoteInput.trim() || null;

    setIsSubmitting(true);
    try {
      const result = await grantSupportCreditsAction({
        targetType,
        targetId,
        credits,
        ttlDays,
        referenceNote,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Form.grantError"));
        return;
      }
      toast.success(t("Form.grantSuccess"));
      router.refresh();
      setCreditsInput("");
      setExpiryDaysInput("");
      setReferenceNoteInput("");
      setSelectedOrg(null);
      setSelectedUser(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="target">{t("Form.Fields.target")}</Label>
        <Tabs
          value={targetType}
          onValueChange={(value) =>
            setTargetType(value as SupportCreditTargetType)
          }
        >
          <TabsList>
            <TabsTrigger value="organization">
              {t("Form.Tabs.organization")}
            </TabsTrigger>
            <TabsTrigger value="user">{t("Form.Tabs.user")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {targetType === "organization" ? (
          <AsyncSearchCombobox<AdminOrganizationOption>
            id="target"
            value={selectedOrg}
            onChange={setSelectedOrg}
            search={searchOrganizationsClient}
            getKey={(org) => org.id}
            getTriggerLabel={(org) => org.name}
            renderOption={(org) => (
              <span className="flex flex-col">
                <span>{org.name}</span>
                <span className="text-muted-foreground text-xs">
                  {org.slug}
                </span>
              </span>
            )}
            labels={orgLabels}
          />
        ) : (
          <AsyncSearchCombobox<AdminUserOption>
            id="target"
            value={selectedUser}
            onChange={setSelectedUser}
            search={searchUsersClient}
            getKey={(user) => user.id}
            getTriggerLabel={(user) => user.name}
            renderOption={(user) => (
              <span className="flex flex-col">
                <span>{user.name}</span>
                <span className="text-muted-foreground text-xs">
                  {user.email}
                </span>
              </span>
            )}
            labels={userLabels}
          />
        )}
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="credits">{t("Form.Fields.credits")}</Label>
          <Input
            id="credits"
            type="number"
            min={1}
            step={1}
            value={creditsInput}
            onChange={(event) => setCreditsInput(event.target.value)}
            required
          />
          <p className="text-muted-foreground text-xs">
            {t("Form.creditsHelper")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiryDays">{t("Form.Fields.expiryDays")}</Label>
          <Input
            id="expiryDays"
            type="number"
            min={1}
            step={1}
            value={expiryDaysInput}
            onChange={(event) => setExpiryDaysInput(event.target.value)}
            placeholder={t("Form.expiryPlaceholder")}
          />
          <p className="text-muted-foreground text-xs">
            {t("Form.expiryHelper")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="referenceNote">{t("Form.Fields.referenceNote")}</Label>
        <Textarea
          id="referenceNote"
          value={referenceNoteInput}
          onChange={(event) => setReferenceNoteInput(event.target.value)}
          placeholder={t("Form.referenceNotePlaceholder")}
          rows={3}
          maxLength={500}
        />
        <p className="text-muted-foreground text-xs">
          {t("Form.referenceNoteHelper")}
        </p>
      </div>

      <Separator />

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("Form.submitting") : t("Form.submit")}
      </Button>
    </form>
  );
}
