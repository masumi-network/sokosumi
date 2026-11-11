"use client";

import { CalendarClock, ChevronDown, Play } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { seoDefaultMarket } from "./seo-analysis-market-model";
import { SeoAnalysisSummary } from "./seo-analysis-summary";
import { SeoField, SeoSelect } from "./seo-form-fields";
import {
  SEO_ANALYSIS_MODULES,
  SEO_COUNTRIES,
  SEO_DEVICES,
  SEO_FULL_AUDIT_KEYWORDS,
  SEO_MAX_MONITOR_RUNS,
  SEO_MAX_PAGES,
  SEO_MAX_PROVIDER_CALLS,
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(monitor ? "monitor.create" : "analysis.title")}
          </DialogTitle>
          <DialogDescription>
            {t(monitor ? "monitor.description" : "analysis.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          // A closed field the browser refuses cannot take focus: open the fields so its message shows.
          onInvalidCapture={() => form.setOptionsOpen(true)}
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(new FormData(event.currentTarget));
          }}
        >
          {monitor ? null : (
            <>
              <SeoAnalysisSummary
                kind={form.kind}
                pages={form.workspace.scope.pageIds.length}
                scopeName={form.workspace.scope.name}
                countryCode={market.countryCode}
                languageCode={market.languageCode}
                devices={form.devices}
                keywords={form.wantsKeywords ? market.keywords : null}
                limits={
                  multiPageFull
                    ? {
                        kind: "full",
                        usd: Number(form.usd) || 0,
                        seconds: Number(form.seconds) || 0,
                      }
                    : full
                      ? { kind: "standard" }
                      : form.usesPaidData
                        ? {
                            kind: "requests",
                            count: Number(form.providerCalls) || 0,
                          }
                        : { kind: "free" }
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2"
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
            </>
          )}
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
            {form.serviceAvailable && !form.canUsePaidSearchData ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t("analysis.htmlService")}
              </p>
            ) : null}
            {monitor ? (
              <p className="text-muted-foreground text-sm">
                {t("pages.count", {
                  count: form.workspace.scope.pageIds.length,
                })}
                : {form.workspace.scope.name}
              </p>
            ) : null}
            {form.workspace.scope.pageIds.length > SEO_MAX_PAGES ? (
              <p role="alert" className="text-destructive text-sm">
                {t("analysis.scopeTooLarge", { count: SEO_MAX_PAGES })}
              </p>
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
                  defaultValue={form.workspace.competitors
                    .filter((row) => row.confirmed)
                    .map((row) => row.url)
                    .join("\n")}
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
            {multiPageFull ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <SeoField id="seo-analysis-usd" label={t("analysis.usd")}>
                  <Input
                    id="seo-analysis-usd"
                    name="usd"
                    type="number"
                    min="0.3"
                    max="50"
                    step="0.01"
                    value={form.usd}
                    onChange={(event) => form.setUsd(event.target.value)}
                    required
                  />
                </SeoField>
                <SeoField
                  id="seo-analysis-seconds"
                  label={t("analysis.seconds")}
                >
                  <Input
                    id="seo-analysis-seconds"
                    name="seconds"
                    type="number"
                    min="60"
                    max="3600"
                    value={form.seconds}
                    onChange={(event) => form.setSeconds(event.target.value)}
                    required
                  />
                </SeoField>
              </div>
            ) : full ? (
              <p className="text-muted-foreground text-sm">
                {t("analysis.standardPageLimits")}
              </p>
            ) : form.usesPaidData ? (
              <SeoField id="seo-analysis-limit" label={t("analysis.requests")}>
                <Input
                  id="seo-analysis-limit"
                  name="maxProviderCalls"
                  type="number"
                  min="0"
                  max={SEO_MAX_PROVIDER_CALLS}
                  value={form.providerCalls}
                  onChange={(event) =>
                    form.setProviderCalls(event.target.value)
                  }
                  required
                />
              </SeoField>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("analysis.htmlOnly")}
              </p>
            )}
          </div>
          {monitor ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <SeoField id="seo-monitor-cadence" label={t("monitor.cadence")}>
                  <SeoSelect
                    id="seo-monitor-cadence"
                    name="cadence"
                    defaultValue="weekly"
                    options={[
                      { value: "daily", label: t("monitor.daily") },
                      { value: "weekly", label: t("monitor.weekly") },
                    ]}
                  />
                </SeoField>
                <SeoField id="seo-monitor-runs" label={t("monitor.runs")}>
                  <Input
                    id="seo-monitor-runs"
                    name="targetRunCount"
                    type="number"
                    min="1"
                    max={SEO_MAX_MONITOR_RUNS}
                    value={form.runCount}
                    onChange={(event) => form.setRunCount(event.target.value)}
                    required
                  />
                </SeoField>
              </div>
              <SeoField id="seo-monitor-zone" label={t("monitor.timeZone")}>
                <Input
                  id="seo-monitor-zone"
                  name="timeZone"
                  value={form.timeZone}
                  onChange={(event) => form.setTimeZone(event.target.value)}
                  maxLength={100}
                  required
                />
              </SeoField>
              <p className="text-muted-foreground text-sm">
                {t("monitor.cap", {
                  runs: Number(form.runCount) || 0,
                  calls: Number.isFinite(form.totalProviderCalls)
                    ? form.totalProviderCalls
                    : 0,
                })}
              </p>
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
          <p className="text-muted-foreground text-sm">
            {t(form.usesPaidData ? "analysis.cost" : "analysis.htmlCost")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={model.pending}
              onClick={() => model.setDialog(null)}
            >
              {t(noService ? "analysis.returnToAudit" : "cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                noService ||
                model.pending ||
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
