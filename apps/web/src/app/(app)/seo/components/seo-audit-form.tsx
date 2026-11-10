"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SEO_AUDIT_NAME_MAX } from "./seo-audit-name";
import { SeoField } from "./seo-form-fields";
import type { useCreateSeoAudit } from "./use-create-seo-audit";

export function SeoAuditForm({
  form,
  showCancel = false,
}: {
  form: ReturnType<typeof useCreateSeoAudit>;
  showCancel?: boolean;
}) {
  const t = useTranslations("App.Seo");
  return (
    <form
      aria-label={t("audits.create")}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit(new FormData(event.currentTarget));
      }}
    >
      <SeoField id="seo-audit-url" label={t("audits.firstPage")}>
        <Input
          id="seo-audit-url"
          name="url"
          type="url"
          placeholder={t("audits.urlPlaceholder")}
          maxLength={4096}
          required
          disabled={form.pending}
        />
      </SeoField>
      <SeoField
        id="seo-audit-name"
        label={t("audits.name")}
        help={t("audits.nameHelp")}
      >
        <Input
          id="seo-audit-name"
          name="name"
          aria-describedby="seo-audit-name-help"
          maxLength={SEO_AUDIT_NAME_MAX}
          disabled={form.pending}
        />
      </SeoField>
      {form.error ? (
        <p role="alert" className="text-destructive text-sm">
          {form.error}
        </p>
      ) : null}
      <DialogFooter>
        {showCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => form.setOpen(false)}
            disabled={form.pending}
          >
            {t("cancel")}
          </Button>
        ) : null}
        <Button type="submit" loading={form.pending} disabled={form.pending}>
          {t("audits.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}
