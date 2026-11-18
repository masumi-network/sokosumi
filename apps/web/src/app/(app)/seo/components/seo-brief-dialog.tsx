"use client";

import type { ProjectSeoPage, SeoAuditBrief } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
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
import {
  briefDraft,
  briefPage,
  briefRequest,
  canSetBriefPage,
  changeBriefPage,
  SEO_BRIEF_ACTIONS,
  SEO_BRIEF_CONSTRAINTS_LIMIT,
  SEO_BRIEF_INDEX_INTENTS,
  SEO_BRIEF_OBJECTIVES,
  SEO_BRIEF_PAGE_LIMIT,
  SEO_BRIEF_ROLES,
  SEO_BRIEF_TEXT_LIMIT,
} from "./seo-brief-model";
import { SeoBriefFollowUp } from "./seo-brief-summary";
import { SeoField, SeoSelect } from "./seo-form-fields";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type BriefModel = SeoWorkspaceModel["brief"];
type SavedPage = Pick<ProjectSeoPage, "id" | "label" | "url">;
const UNSET = "unset";

export function SeoBriefDialog({
  model,
  onClose = () => model.setDialog(null),
}: {
  model: SeoWorkspaceModel;
  onClose?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("brief.title")}</DialogTitle>
          <DialogDescription>{t("brief.private")}</DialogDescription>
        </DialogHeader>
        {model.brief.data ? (
          <BriefEditor
            initial={model.brief.data}
            pages={model.data.pages}
            selectedPage={model.filters.pageId}
            brief={model.brief}
            busy={busy}
            setBusy={setBusy}
            close={onClose}
          />
        ) : model.brief.error ? (
          <div role="alert">
            <p>{t("brief.readFailed")}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void model.brief.reload()}
            >
              {t("brief.retry")}
            </Button>
          </div>
        ) : (
          <p role="status">{t("loading")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BriefEditor({
  initial,
  pages,
  selectedPage,
  brief,
  busy,
  setBusy,
  close,
}: {
  initial: SeoAuditBrief;
  pages: SavedPage[];
  selectedPage: string | null;
  brief: BriefModel;
  busy: boolean;
  setBusy: (value: boolean) => void;
  close: () => void;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const [draft, setDraft] = useState(() => briefDraft(initial));
  const [pageId, setPageId] = useState(selectedPage ?? pages[0]?.id ?? "");
  const [error, setError] = useState<"conflict" | "error" | null>(null);
  const saving = useRef(false);
  const page = briefPage(draft.pages, pageId);
  const followUp = initial.followUps.find((item) => item.pageId === pageId);
  const full = !canSetBriefPage(draft.pages, pageId);
  const options = (values: readonly string[], group: string) =>
    values.map((value) => ({
      value,
      label: t(`brief.${group}.${value.replaceAll(" ", "_")}`),
    }));
  const optional = (values: readonly string[], group: string) => [
    { value: UNSET, label: t("brief.unset") },
    ...options(values, group),
  ];
  const editPage = (change: Partial<typeof page>) =>
    setDraft((prev) => ({
      ...prev,
      pages: changeBriefPage(prev.pages, {
        ...briefPage(prev.pages, pageId),
        ...change,
      }),
    }));
  async function submit() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const result = await brief.save(briefRequest(draft));
      if (result === "saved") close();
      else setError(result);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    const result = await brief.reload();
    if (result.isSuccess && result.data) {
      setDraft(briefDraft(result.data));
      setError(null);
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        {initial.updatedAt && (
          <p className="text-muted-foreground text-sm">
            {t("brief.confirmed", {
              date: format.dateTime(new Date(initial.updatedAt), {
                dateStyle: "medium",
              }),
            })}
          </p>
        )}
        <SeoField id="seo-brief-objective" label={t("brief.objective")}>
          <SeoSelect
            id="seo-brief-objective"
            value={draft.objective ?? UNSET}
            options={optional(SEO_BRIEF_OBJECTIVES, "objectives")}
            onValueChange={(v) =>
              setDraft((p) => ({
                ...p,
                objective: SEO_BRIEF_OBJECTIVES.find((x) => x === v) ?? null,
              }))
            }
          />
        </SeoField>
        <SeoField id="seo-brief-audience" label={t("brief.audience")}>
          <Input
            id="seo-brief-audience"
            value={draft.audience ?? ""}
            maxLength={SEO_BRIEF_TEXT_LIMIT}
            onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
          />
        </SeoField>
        <SeoField id="seo-brief-outcome" label={t("brief.outcome")}>
          <Input
            id="seo-brief-outcome"
            value={draft.outcome ?? ""}
            maxLength={SEO_BRIEF_TEXT_LIMIT}
            onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
          />
        </SeoField>
        <SeoField id="seo-brief-constraints" label={t("brief.constraints")}>
          <Textarea
            id="seo-brief-constraints"
            rows={2}
            value={draft.constraints ?? ""}
            maxLength={SEO_BRIEF_CONSTRAINTS_LIMIT}
            onChange={(e) =>
              setDraft({ ...draft, constraints: e.target.value })
            }
          />
        </SeoField>
      </fieldset>
      {!!pages.length && (
        <fieldset className="space-y-4 border-t pt-4" disabled={busy}>
          <legend className="pe-2 text-sm font-semibold">
            {t("brief.pageSettings")}
          </legend>
          <SeoField id="seo-brief-page" label={t("brief.page")}>
            <SeoSelect
              id="seo-brief-page"
              value={pageId}
              onValueChange={setPageId}
              options={pages.map((p) => ({
                value: p.id,
                label: p.label || p.url,
              }))}
            />
          </SeoField>
          {full ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("brief.pageLimit", { count: SEO_BRIEF_PAGE_LIMIT })}
            </p>
          ) : (
            <>
              <SeoField id="seo-brief-role" label={t("brief.role")}>
                <SeoSelect
                  id="seo-brief-role"
                  value={page.role ?? UNSET}
                  options={optional(SEO_BRIEF_ROLES, "roles")}
                  onValueChange={(v) =>
                    editPage({
                      role: SEO_BRIEF_ROLES.find((x) => x === v) ?? null,
                    })
                  }
                />
              </SeoField>
              <SeoField id="seo-brief-job" label={t("brief.job")}>
                <Input
                  id="seo-brief-job"
                  maxLength={SEO_BRIEF_TEXT_LIMIT}
                  value={page.job ?? ""}
                  onChange={(e) => editPage({ job: e.target.value })}
                />
              </SeoField>
              <div className="grid gap-4 sm:grid-cols-2">
                <SeoField id="seo-brief-action" label={t("brief.action")}>
                  <SeoSelect
                    id="seo-brief-action"
                    value={page.action ?? UNSET}
                    options={optional(SEO_BRIEF_ACTIONS, "actions")}
                    onValueChange={(v) =>
                      editPage({
                        action: SEO_BRIEF_ACTIONS.find((x) => x === v) ?? null,
                      })
                    }
                  />
                </SeoField>
                <SeoField id="seo-brief-index" label={t("brief.index")}>
                  <SeoSelect
                    id="seo-brief-index"
                    value={page.indexIntent}
                    options={options(SEO_BRIEF_INDEX_INTENTS, "visibility")}
                    onValueChange={(v) =>
                      editPage({
                        indexIntent:
                          SEO_BRIEF_INDEX_INTENTS.find((x) => x === v) ??
                          "unknown",
                      })
                    }
                  />
                </SeoField>
              </div>
            </>
          )}
        </fieldset>
      )}
      {followUp ? <SeoBriefFollowUp followUp={followUp} /> : null}
      {error && (
        <div role="alert" className="space-y-2 text-sm">
          <p>{t(error === "conflict" ? "brief.conflict" : "saveFailed")}</p>
          {error === "conflict" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void reload()}
            >
              {t("brief.reload")}
            </Button>
          )}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={close}>
          {t("cancel")}
        </Button>
        <Button type="submit" loading={busy} disabled={error === "conflict"}>
          {t("brief.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
