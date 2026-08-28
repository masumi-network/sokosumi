import { LockKeyhole } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { SokoBotVersionActions } from "@/components/admin/soko-bots/soko-bot-version-actions.client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type {
  AdminSokoBotQuality,
  SokoBotLabRun,
  SokoBotVersionDetail as VersionDetail,
} from "@/lib/clients/generated/core";

interface SokoBotVersionDetailProps {
  version: VersionDetail;
  quality: AdminSokoBotQuality;
  labRuns: SokoBotLabRun[];
}

function getVerdictTranslationKey(
  verdict: "pass" | "weak" | "fail",
): "Values.judgePass" | "Values.judgeWeak" | "Values.judgeFail" {
  if (verdict === "pass") {
    return "Values.judgePass";
  }
  if (verdict === "weak") {
    return "Values.judgeWeak";
  }
  return "Values.judgeFail";
}

export async function SokoBotVersionDetail({
  version,
  quality,
  labRuns,
}: SokoBotVersionDetailProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Versions"),
    getFormatter(),
  ]);

  function formatRegion(region: string | null): string {
    if (region === "eu") {
      return t("Values.eu");
    }
    if (region === "us") {
      return t("Values.us");
    }
    return region ?? t("Values.noRegion");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {version.name}
            </h1>
            {version.isDefault ? <Badge>{t("State.default")}</Badge> : null}
            <Badge variant="outline">
              {t(version.authored ? "State.authored" : "State.builtIn")}
            </Badge>
          </div>
          <p className="text-muted-foreground font-mono text-xs">
            {version.id}
          </p>
          <p className="text-muted-foreground max-w-3xl text-sm">
            {version.summary}
          </p>
        </div>
        <SokoBotVersionActions version={version} />
      </header>

      {!version.authored ? (
        <Alert>
          <LockKeyhole aria-hidden />
          <AlertTitle>{t("Detail.readOnlyTitle")}</AlertTitle>
          <AlertDescription>{t("Detail.builtInReadOnly")}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{t("Detail.model")}</p>
          <p className="break-all font-mono text-xs">{version.model}</p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{t("Detail.region")}</p>
          <p>{formatRegion(version.inferenceRegion)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{t("Detail.skills")}</p>
          <p>{version.skills.join(", ") || t("Values.none")}</p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{t("Detail.tools")}</p>
          <p>{version.capabilities.join(", ") || t("Values.allRouteTools")}</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h2 className="font-semibold">{t("Detail.realRuns")}</h2>
            <p className="text-muted-foreground text-xs">
              {t("Detail.realRunsHint")}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <div className="bg-muted/40 rounded-md border p-3">
              <dt className="text-muted-foreground text-xs">
                {t("Detail.turns")}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {quality.overall.turns}
              </dd>
            </div>
            <div className="bg-muted/40 rounded-md border p-3">
              <dt className="text-muted-foreground text-xs">
                {t("Detail.judged")}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {quality.overall.judged}
              </dd>
            </div>
            <div className="bg-muted/40 rounded-md border p-3">
              <dt className="text-muted-foreground text-xs">
                {t("Detail.avgScore")}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {quality.overall.avgScore === null
                  ? "—"
                  : format.number(quality.overall.avgScore, {
                      maximumFractionDigits: 2,
                    })}
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h2 className="font-semibold">{t("Detail.labHistory")}</h2>
            <p className="text-muted-foreground text-xs">
              {t("Detail.labHistoryHint")}
            </p>
          </div>
          {labRuns.length > 0 ? (
            <ol className="divide-y rounded-md border">
              {labRuns.slice(0, 8).map((run) => (
                <li
                  key={run.id}
                  className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{run.scenarioId}</p>
                    <p className="text-muted-foreground text-xs">
                      {format.dateTime(run.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">
                      {run.passed}/{run.total}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {run.judge
                        ? t(getVerdictTranslationKey(run.judge.verdict))
                        : t("Detail.notJudged")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("Detail.neverRunInLab")}
            </p>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("Detail.prompt")}</h2>
          <p className="text-muted-foreground text-xs">
            {t("Detail.promptHint")}
          </p>
        </div>
        <pre className="bg-muted/30 max-h-[48rem] overflow-auto rounded-lg border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {version.systemPrompt}
        </pre>
      </section>
    </div>
  );
}
