"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SEO_NO_TARGET_PAGE } from "./seo-form-model";
import { useSeoEdit } from "./use-seo-edit";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoEditDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const form = useSeoEdit(model);
  const kind = model.dialog;
  if (
    kind !== "page" &&
    kind !== "scope" &&
    kind !== "edit_scope" &&
    kind !== "keyword" &&
    kind !== "edit_keyword" &&
    kind !== "competitor"
  )
    return null;
  const scope =
    kind === "edit_scope"
      ? form.workspace.scopes.find(
          (item) => item.id === form.workspace.scope.id,
        )
      : null;
  const group = kind === "scope" || kind === "edit_scope";
  const keywordForm = kind === "keyword" || kind === "edit_keyword";
  const editingKeyword = kind === "edit_keyword" ? form.keyword : null;
  const title =
    kind === "page"
      ? t("addPage")
      : kind === "scope"
        ? t("createScope")
        : kind === "edit_scope"
          ? t("editScope")
          : kind === "edit_keyword"
            ? t("keywords.edit")
            : kind === "keyword"
              ? t("keywords.add")
              : t("competitors.add");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent className="max-h-dvh overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {group
              ? t("scopeHelp")
              : kind === "page"
                ? t("pageHelp")
                : keywordForm
                  ? t("keywords.help")
                  : t("competitors.help")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(kind, new FormData(event.currentTarget));
          }}
          className="space-y-4"
        >
          {kind === "page" || kind === "competitor" ? (
            <SeoField id="seo-edit-url" label={t("url")}>
              <Input
                id="seo-edit-url"
                name="url"
                type="url"
                defaultValue={
                  kind === "page"
                    ? (form.workspace.websiteUrl ?? undefined)
                    : undefined
                }
                required
                maxLength={4096}
              />
            </SeoField>
          ) : null}
          {kind === "page" ? (
            <>
              <SeoField id="seo-edit-label" label={t("label")}>
                <Input id="seo-edit-label" name="label" maxLength={200} />
              </SeoField>
              <SeoField
                id="seo-edit-parent"
                label={`${t("relatedTo")} (${t("optional")})`}
              >
                <SeoSelect
                  id="seo-edit-parent"
                  name="relatedToPageId"
                  options={form.workspace.pages.map((page) => ({
                    value: page.id,
                    label: page.label || page.url,
                  }))}
                />
              </SeoField>
            </>
          ) : null}
          {group ? (
            <>
              <SeoField id="seo-edit-name" label={t("name")}>
                <Input
                  id="seo-edit-name"
                  name="name"
                  defaultValue={scope?.name}
                  maxLength={100}
                  required
                />
              </SeoField>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-sm font-medium">
                  {t("selectPages")}
                </legend>
                {form.workspace.pages.map((page) => (
                  <div className="flex items-start gap-2" key={page.id}>
                    <Checkbox
                      name="pageIds"
                      value={page.id}
                      id={`seo-member-${page.id}`}
                      defaultChecked={scope?.pageIds.includes(page.id)}
                    />
                    <Label
                      htmlFor={`seo-member-${page.id}`}
                      className="min-w-0 font-normal break-all"
                    >
                      {page.label || page.url}
                    </Label>
                  </div>
                ))}
              </fieldset>
              {scope ? (
                <p className="text-muted-foreground text-sm">
                  {t("scopeVersion", { version: scope.version })}
                </p>
              ) : null}
            </>
          ) : null}
          {keywordForm ? (
            <>
              <SeoField id="seo-edit-keyword" label={t("keywords.keyword")}>
                <Input
                  id="seo-edit-keyword"
                  name="keyword"
                  maxLength={200}
                  defaultValue={editingKeyword?.keyword}
                  readOnly={!!editingKeyword}
                  required
                />
              </SeoField>
              <div className="grid gap-3 sm:grid-cols-2">
                <SeoField id="seo-edit-country" label={t("keywords.country")}>
                  <Input
                    id="seo-edit-country"
                    name="countryCode"
                    required
                    pattern="[A-Za-z]{2}"
                    maxLength={2}
                    defaultValue={editingKeyword?.countryCode}
                    readOnly={!!editingKeyword}
                  />
                </SeoField>
                <SeoField id="seo-edit-language" label={t("keywords.language")}>
                  <Input
                    id="seo-edit-language"
                    name="languageCode"
                    required
                    pattern="[a-z]{2,3}(-[A-Z]{2})?"
                    maxLength={6}
                    defaultValue={editingKeyword?.languageCode}
                    readOnly={!!editingKeyword}
                  />
                </SeoField>
              </div>
              <SeoField id="seo-edit-target" label={t("keywords.target")}>
                <SeoSelect
                  id="seo-edit-target"
                  name="pageId"
                  defaultValue={
                    editingKeyword?.targetPageId ?? SEO_NO_TARGET_PAGE
                  }
                  options={[
                    { value: SEO_NO_TARGET_PAGE, label: t("keywords.anyPage") },
                    ...form.workspace.pages.map((page) => ({
                      value: page.id,
                      label: page.label || page.url,
                    })),
                  ]}
                  placeholder={t("keywords.anyPage")}
                />
              </SeoField>
              <SeoField id="seo-edit-priority" label={t("keywords.priority")}>
                <SeoSelect
                  id="seo-edit-priority"
                  name="priority"
                  defaultValue={editingKeyword?.priority ?? "medium"}
                  options={["low", "medium", "high"].map((value) => ({
                    value,
                    label: t(`priority.${value}`),
                  }))}
                />
              </SeoField>
            </>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={model.pending}
              onClick={() => model.setDialog(null)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={model.pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
