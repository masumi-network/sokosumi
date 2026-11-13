"use client";

import { CalendarClock, ChevronDown, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { TaskScheduleWhen } from "@/app/tasks/components/task-schedule-when";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { seoDefaultMarket } from "./seo-analysis-market-model";
import {
  type SeoAnalysisLimits,
  SeoAnalysisSummary,
} from "./seo-analysis-summary";
import { SeoField, SeoSelect } from "./seo-form-fields";
import {
  SEO_ANALYSIS_MODULES,
  SEO_COUNTRIES,
  SEO_DEVICES,
  SEO_FULL_AUDIT_KEYWORDS,
  SEO_FULL_AUDIT_LIMITS,
  SEO_MAX_MONITOR_RUNS,
  SEO_MAX_PAGES,
  seoAnalysisMaxCredits,
} from "./seo-form-model";
import { useSeoAnalysisForm } from "./use-seo-analysis";
import { useSeoAnalysisMarket } from "./use-seo-analysis-market";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const OPTIONS_ID = "seo-analysis-options";

export function SeoAnalysisDialog({
  model,
  monitor = false,
}: {
  model: SeoWorkspaceModel;
  monitor?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const form = useSeoAnalysisForm(model, monitor);
  const full = form.kind === "audit_full";
  const multiPageFull = full && form.workspace.scope.pageIds.length > 1;
  const noService = !form.serviceAvailable;
  const market = useSeoAnalysisMarket(
    form.workspace.keywords,
    full ? SEO_FULL_AUDIT_KEYWORDS : undefined,
    seoDefaultMarket(form.workspace),
  );
  const limits: SeoAnalysisLimits = multiPageFull
    ? { kind: "full", ...SEO_FULL_AUDIT_LIMITS }
    : full
      ? { kind: "standard" }
      : form.usesPaidData
        ? { kind: "requests", count: form.providerCallsFor(market.keywords) }
        : { kind: "free" };
  const maxCredits = seoAnalysisMaxCredits(limits);
  const runs =
    form.rule?.endsMode === "AFTER" ? form.rule.targetRunCount : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent
        className="max-h-dvh overflow-y-auto sm:max-w-lg"
        // The dialog itself, not "Change options": a ring on the fold outshone the submit. Tab goes on from here.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(monitor ? "monitor.create" : "analysis.title")}
          </DialogTitle>
          <DialogDescription>
            {t(monitor ? "monitor.description" : "analysis.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          // A closed field the browser refuses cannot take focus: open the fields so its message shows.
          onInvalidCapture={() => form.setOptionsOpen(true)}
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(new FormData(event.currentTarget));
          }}
        >
          {/* What runs, in one card; its fields open from the card only when the reader wants to change one. */}
          <div className="bg-muted space-y-2 rounded-lg p-4">
            <SeoAnalysisSummary
              kind={form.kind}
              pages={form.workspace.scope.pageIds.length}
              // The page picker's own choice: "All N pages" when nothing is picked, else the group's name.
              scopeName={
                model.filters.scopeId ? form.workspace.scope.name : null
              }
              allPages={!model.filters.scopeId && !model.filters.pageId}
              countryCode={market.countryCode}
              languageCode={market.languageCode}
              devices={form.devices}
              keywords={form.wantsKeywords ? market.keywords : null}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground -ml-2"
              aria-expanded={form.optionsOpen}
              aria-controls={OPTIONS_ID}
              onClick={() => form.setOptionsOpen((open) => !open)}
            >
              <ChevronDown
                className={cn(
                  "transition-transform duration-150 ease-out motion-reduce:transition-none",
                  form.optionsOpen && "rotate-180",
                )}
              />
              {t("analysis.options")}
            </Button>
          </div>
          {/* What limits or stops the check shows with the fields closed too: it explains the button. */}
          {form.serviceAvailable && !form.canUsePaidSearchData ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("analysis.htmlService")}
            </p>
          ) : null}
          {form.workspace.scope.pageIds.length > SEO_MAX_PAGES ? (
            <p role="alert" className="text-destructive text-sm">
              {t("analysis.scopeTooLarge", { count: SEO_MAX_PAGES })}
            </p>
          ) : null}
          {/* Closed fields stay in the form, so the check starts with their values. */}
          <div id={OPTIONS_ID} hidden={!form.optionsOpen} className="space-y-4">
            <SeoField id="seo-analysis-kind" label={t("analysis.kind")}>
              <SeoSelect
                id="seo-analysis-kind"
                name="kind"
                value={form.kind}
                onValueChange={form.setKind}
                options={form.kinds.map((value) => ({
                  value,
                  label: t(`analysis.${value}`),
                }))}
              />
            </SeoField>
            {form.kind === "audit_lite" && form.canUsePaidSearchData ? (
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium">
                  {t("analysis.modules")}
                </legend>
                {SEO_ANALYSIS_MODULES.map((module) => (
                  <div className="flex items-center gap-2" key={module}>
                    <Checkbox
                      name="analyses"
                      value={module}
                      id={`seo-module-${module}`}
                      checked={form.modules.includes(module)}
                      onCheckedChange={(checked) =>
                        form.toggleModule(module, checked === true)
                      }
                    />
                    <Label htmlFor={`seo-module-${module}`}>
                      {t(`analysis.moduleNames.${module.replace(".", "_")}`)}
                    </Label>
                  </div>
                ))}
              </fieldset>
            ) : form.kind === "audit_lite" ? (
              <input type="hidden" name="analyses" value="page.inspect" />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <SeoField id="seo-analysis-country" label={t("analysis.country")}>
                <SeoSelect
                  id="seo-analysis-country"
                  name="countryCode"
                  value={market.countryCode}
                  onValueChange={market.setCountryCode}
                  required
                  options={SEO_COUNTRIES.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </SeoField>
              <SeoField
                id="seo-analysis-language"
                label={t("analysis.language")}
              >
                <Input
                  id="seo-analysis-language"
                  name="languageCode"
                  value={market.languageCode}
                  onChange={(event) =>
                    market.setLanguageCode(event.target.value)
                  }
                  required
                  pattern="[a-z]{2}"
                  maxLength={2}
                />
              </SeoField>
            </div>
            {form.wantsKeywords ? (
              <SeoField
                id="seo-analysis-keywords"
                label={t("analysis.keywords")}
                help={t(full ? "analysis.fullHelp" : "analysis.keywordsHelp")}
              >
                <Textarea
                  id="seo-analysis-keywords"
                  name="keywords"
                  rows={3}
                  value={market.keywords}
                  onChange={(event) => market.setKeywords(event.target.value)}
                />
              </SeoField>
            ) : null}
            {form.wantsCompetitors ? (
              <SeoField
                id="seo-analysis-competitors"
                label={t("analysis.competitors")}
              >
                <Textarea
                  id="seo-analysis-competitors"
                  name="competitorUrls"
                  rows={3}
                  value={form.competitorUrls}
                  onChange={(event) =>
                    form.setCompetitorUrls(event.target.value)
                  }
                />
              </SeoField>
            ) : null}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                {t("analysis.devices")}
              </legend>
              <div className="flex flex-wrap gap-4">
                {SEO_DEVICES.map((device) => (
                  <div className="flex items-center gap-2" key={device}>
                    <Checkbox
                      id={`seo-device-${device}`}
                      name="devices"
                      value={device}
                      checked={form.devices.includes(device)}
                      onCheckedChange={(checked) =>
                        form.toggleDevice(device, checked === true)
                      }
                    />
                    <Label htmlFor={`seo-device-${device}`}>
                      {t(`analysis.${device}`)}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
            {full || form.usesPaidData ? null : (
              <p className="text-muted-foreground text-sm">
                {t("analysis.htmlOnly")}
              </p>
            )}
          </div>
          {monitor ? (
            <div className="space-y-4">
              <TaskScheduleWhen
                value={form.when}
                onChange={form.setWhen}
                maxRunCount={SEO_MAX_MONITOR_RUNS}
              />
              {form.tooOften ? (
                <p role="alert" className="text-destructive text-xs">
                  {t("monitor.onceADay")}
                </p>
              ) : null}
            </div>
          ) : null}
          {noService ? (
            <div className="space-y-2">
              <p role="status" className="text-muted-foreground text-sm">
                {t(
                  monitor
                    ? "monitor.unavailable"
                    : "analysis.serviceUnavailable",
                )}
              </p>
            </div>
          ) : null}
          {/* The one figure the reader decides on: the price in credits, the same ceiling Core checks. */}
          {maxCredits ? (
            <dl className="flex items-baseline justify-between gap-4 border-t pt-4">
              <dt className="text-muted-foreground text-sm">
                {t(monitor ? "analysis.pricePerRun" : "analysis.price")}
              </dt>
              <dd className="text-right" aria-live="polite">
                <span className="block font-semibold">
                  {t("analysis.maxCredits", { credits: maxCredits })}
                </span>
                {/* A schedule that ends after a number of runs has a total: the reader need not multiply. */}
                {monitor && runs ? (
                  <span className="text-muted-foreground block text-xs">
                    {t("analysis.maxCreditsTotal", {
                      credits: maxCredits * runs,
                      runs,
                    })}
                  </span>
                ) : null}
                <span className="text-muted-foreground block text-xs">
                  {t(
                    monitor
                      ? "analysis.failedRunFree"
                      : "analysis.failedCheckFree",
                  )}
                </span>
              </dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={model.pending}
              onClick={() => model.setDialog(null)}
            >
              {t(noService ? "analysis.returnToAudit" : "cancel")}
            </Button>
            {/* The one commit of the dialog wears the one brand fill, as every Sokosumi form's submit. */}
            <Button
              type="submit"
              variant="primary"
              disabled={
                noService ||
                model.pending ||
                (monitor && !form.rule) ||
                !form.workspace.scope.pageIds.length ||
                form.workspace.scope.pageIds.length > SEO_MAX_PAGES
              }
            >
              {monitor ? <CalendarClock /> : <Play />}
              {t(monitor ? "monitor.create" : "analysis.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
