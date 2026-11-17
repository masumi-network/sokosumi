"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
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
import { seoDefaultMarket } from "./seo-analysis-market-model";
import { SeoField, SeoSelect, seoFieldHelpId } from "./seo-form-fields";
import {
  SEO_COUNTRIES,
  SEO_LANGUAGES,
  SEO_NO_RELATED_PAGE,
  SEO_NO_TARGET_PAGE,
  seoKeywordTargetPageId,
  seoMainPageId,
} from "./seo-form-model";
import { seoMarketName } from "./seo-shared";
import { useSeoEdit } from "./use-seo-edit";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoEditDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const locale = useLocale();
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
  // A saved keyword keeps its market; a new one opens on the market a check would.
  const market = editingKeyword
    ? {
        countryCode: editingKeyword.countryCode,
        languageCode: editingKeyword.languageCode,
      }
    : seoDefaultMarket(form.workspace);
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
                  ? t("keywords.dialogHelp")
                  : t("competitors.dialogHelp")}
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
                // Not type="url": it refuses "example.com", which the command completes to https://.
                inputMode="url"
                autoComplete="url"
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
              <SeoField id="seo-edit-parent" label={t("relatedTo")}>
                {/* A new page belongs to the main page unless the user says it stands alone. */}
                <SeoSelect
                  id="seo-edit-parent"
                  name="relatedToPageId"
                  defaultValue={seoMainPageId(form.workspace)}
                  options={[
                    ...form.workspace.pages.map((page) => ({
                      value: page.id,
                      label: page.label || page.url,
                    })),
                    { value: SEO_NO_RELATED_PAGE, label: t("notRelated") },
                  ]}
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
                  defaultValue={
                    editingKeyword?.keyword ?? model.keywordDraft?.keyword
                  }
                  readOnly={!!editingKeyword}
                  required
                />
              </SeoField>
              <div className="grid gap-3 sm:grid-cols-2">
                <SeoMarketField
                  id="seo-edit-country"
                  name="countryCode"
                  label={t("analysis.country")}
                  codeLabel={t("keywords.country")}
                  codeHelp={t("keywords.countryHelp")}
                  otherLabel={t("keywords.otherCode")}
                  codes={SEO_COUNTRIES}
                  current={market.countryCode}
                  nameOf={(code) => seoMarketName(locale, code, null)}
                  disabled={!!editingKeyword}
                  pattern="[A-Za-z]{2}"
                  maxLength={2}
                />
                <SeoMarketField
                  id="seo-edit-language"
                  name="languageCode"
                  label={t("analysis.language")}
                  codeLabel={t("keywords.language")}
                  codeHelp={t("keywords.languageHelp")}
                  otherLabel={t("keywords.otherCode")}
                  codes={SEO_LANGUAGES}
                  current={market.languageCode}
                  nameOf={(code) => seoMarketName(locale, "", code)}
                  disabled={!!editingKeyword}
                  pattern="[a-z]{2,3}(-[A-Z]{2})?"
                  maxLength={6}
                />
              </div>
              <SeoField id="seo-edit-target" label={t("keywords.target")}>
                <SeoSelect
                  id="seo-edit-target"
                  name="pageId"
                  defaultValue={
                    (editingKeyword
                      ? seoKeywordTargetPageId(
                          editingKeyword,
                          form.workspace.pages,
                        )
                      : null) ??
                    model.keywordDraft?.pageId ??
                    SEO_NO_TARGET_PAGE
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

/** Not a code: the picker's way to a typed code. */
const SEO_OTHER_CODE = "other";

/**
 * A market part picked by name; the form saves its code. "Other code" opens a code field for a market off the
 * list, so every code the field took before still saves. A saved code off the list stays as its own option.
 */
function SeoMarketField({
  id,
  name,
  label,
  codeLabel,
  codeHelp,
  otherLabel,
  codes,
  current,
  nameOf,
  disabled,
  pattern,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  codeLabel: string;
  codeHelp: string;
  otherLabel: string;
  codes: readonly string[];
  current: string;
  nameOf: (code: string) => string;
  disabled: boolean;
  pattern: string;
  maxLength: number;
}) {
  const [other, setOther] = useState(false);
  const codeId = `${id}-code`;
  const listed =
    !current || codes.includes(current) ? codes : [current, ...codes];
  return (
    <div className="space-y-2">
      <SeoField id={id} label={label}>
        <SeoSelect
          id={id}
          // The typed code is the value while "Other code" is chosen.
          name={other ? undefined : name}
          required
          defaultValue={current}
          onValueChange={(value) => setOther(value === SEO_OTHER_CODE)}
          disabled={disabled}
          options={[
            ...listed.map((value) => ({ value, label: nameOf(value) })),
            ...(disabled ? [] : [{ value: SEO_OTHER_CODE, label: otherLabel }]),
          ]}
        />
      </SeoField>
      {other ? (
        <SeoField id={codeId} label={codeLabel} help={codeHelp}>
          <Input
            id={codeId}
            aria-describedby={seoFieldHelpId(codeId)}
            name={name}
            required
            pattern={pattern}
            maxLength={maxLength}
          />
        </SeoField>
      ) : null}
    </div>
  );
}
