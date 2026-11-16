"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SeoField } from "./seo-form-fields";
import { useSeoPageChange } from "./use-seo-page-change";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoPageChangeDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const form = useSeoPageChange(model);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pageChange.title")}</DialogTitle>
          <DialogDescription>{t("pageChange.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(new FormData(event.currentTarget));
          }}
        >
          <p className="text-muted-foreground text-sm">
            {t("pages.count", { count: form.workspace.scope.pageIds.length })}:{" "}
            {form.workspace.scope.name}
          </p>
          <SeoField id="seo-change-title" label={t("pageChange.summary")}>
            <Input
              id="seo-change-title"
              name="title"
              maxLength={200}
              required
            />
          </SeoField>
          <SeoField
            id="seo-change-time"
            label={t("pageChange.occurredAt")}
            help={form.timeZone}
          >
            <Input
              id="seo-change-time"
              name="occurredAt"
              type="datetime-local"
              required
            />
          </SeoField>
          <SeoField id="seo-change-note" label={t("pageChange.note")}>
            <Textarea
              id="seo-change-note"
              name="note"
              rows={4}
              maxLength={2000}
            />
          </SeoField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={model.pending}
              onClick={() => model.setDialog(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={model.pending || !form.workspace.scope.pageIds.length}
            >
              {t("pageChange.title")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
