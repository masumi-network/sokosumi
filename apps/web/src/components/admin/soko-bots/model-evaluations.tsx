import type {
  AdminSokoBotJudgeEvaluation,
  AdminSokoBotRouterEvaluation,
} from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function ratio(value: number, of: number): string {
  return of > 0 ? `${value}/${of}` : "–";
}

function percent(value: number, of: number): string {
  return of > 0 ? `${Math.round((value / of) * 100)}%` : "–";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The provider prefix is noise in a table of one role's candidates. */
function shortModel(id: string): string {
  return id.slice(id.indexOf("/") + 1);
}

/** The latest run's heading is generic, so its line names the run too. */
function runMeta(
  run: { label: string; createdAt: Date },
  latest: boolean,
  format: Awaited<ReturnType<typeof getFormatter>>,
): string {
  const when = format.dateTime(run.createdAt, "dateTimeMedium");
  return latest ? `${run.label} · ${when}` : when;
}

function RunFrame({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs tabular-nums">{meta}</p>
      </div>
      {children}
    </div>
  );
}

function Disagreements({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="group rounded-md border">
      <summary className="text-muted-foreground cursor-pointer select-none px-3 py-2 text-xs">
        {label}
      </summary>
      <div className="divide-y border-t">{children}</div>
    </details>
  );
}

function VerdictRun({ values }: { values: (string | null)[] }) {
  return (
    <span className="font-mono text-xs tabular-nums">
      {values.map((value, index) => (
        <span
          // Runs are positional; the index is the identity.
          key={index}
          className={cn(
            "mr-1",
            value === null && "text-muted-foreground",
            value === "fail" && "text-semantic-destructive",
          )}
        >
          {value ?? "err"}
        </span>
      ))}
    </span>
  );
}

async function JudgeRun({
  run,
  latest,
  currentModel,
}: {
  run: AdminSokoBotJudgeEvaluation;
  latest: boolean;
  currentModel: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Evaluations"),
    getFormatter(),
  ]);
  const contested = run.cases.filter((item) => item.contested);
  return (
    <RunFrame
      title={latest ? t("latestRun") : run.label}
      meta={runMeta(run, latest, format)}
    >
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Judge.model")}</TableHead>
              <TableHead className="text-right">{t("Judge.matches")}</TableHead>
              <TableHead className="text-right">{t("Judge.steady")}</TableHead>
              <TableHead className="text-right">
                {t("Judge.falseFails")}
              </TableHead>
              <TableHead className="text-right">
                {t("Judge.badCaught")}
              </TableHead>
              <TableHead className="text-right">{t("Judge.errors")}</TableHead>
              <TableHead className="text-right">{t("Judge.cost")}</TableHead>
              <TableHead className="text-right">{t("Judge.time")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...run.models]
              .sort(
                (a, b) =>
                  b.matches / Math.max(b.graded, 1) -
                  a.matches / Math.max(a.graded, 1),
              )
              .map((row) => (
                <TableRow key={row.model}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">
                        {shortModel(row.model)}
                      </span>
                      {row.model === currentModel ? (
                        <Badge>{t("inUse")}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {ratio(row.matches, row.graded)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {ratio(row.steady, row.repeated)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.falseFails}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {ratio(row.badCaught, row.bad)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {ratio(row.errors, row.calls)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {`$${row.costPerCallUsd.toFixed(3)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {seconds(row.medianMs)}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      <Disagreements
        label={t("disagreements", { count: contested.length })}
        count={contested.length}
      >
        {contested.map((item) => (
          <div key={item.caseId} className="space-y-2 px-3 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs">{item.caseId}</span>
              <Badge variant="outline">
                {t("Judge.grade", { grade: item.grade })}
              </Badge>
              {item.set === "known-bad" ? (
                <Badge variant="outline">{t("Judge.knownBad")}</Badge>
              ) : null}
            </div>
            {item.why ? (
              <p className="text-muted-foreground text-xs">{item.why}</p>
            ) : null}
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {Object.entries(item.answers).map(([model, verdicts]) => (
                <div key={model} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground font-mono">
                    {shortModel(model)}
                  </dt>
                  <dd>
                    <VerdictRun values={verdicts} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </Disagreements>
    </RunFrame>
  );
}

async function RouterRun({
  run,
  latest,
  currentModel,
}: {
  run: AdminSokoBotRouterEvaluation;
  latest: boolean;
  currentModel: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Evaluations"),
    getFormatter(),
  ]);
  const contested = run.cases.filter((item) => item.contested);
  return (
    <RunFrame
      title={latest ? t("latestRun") : run.label}
      meta={runMeta(run, latest, format)}
    >
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Router.classifier")}</TableHead>
              <TableHead className="text-right">
                {t("Router.correct")}
              </TableHead>
              <TableHead className="text-right">
                {t("Router.alwaysRight")}
              </TableHead>
              <TableHead className="text-right">
                {t("Router.overGrants")}
              </TableHead>
              <TableHead className="text-right">
                {t("Router.underGrants")}
              </TableHead>
              <TableHead className="text-right">{t("Router.median")}</TableHead>
              <TableHead className="text-right">{t("Router.p90")}</TableHead>
              <TableHead className="text-right">{t("Router.cost")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.models.map((row) => (
              <TableRow key={row.classifier}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">
                      {shortModel(row.classifier)}
                    </span>
                    {row.classifier === currentModel ? (
                      <Badge>{t("inUse")}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {`${percent(row.correct, row.calls)} · ${ratio(row.correct, row.calls)}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ratio(row.alwaysRight, row.cases)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.overGrants > 0 && "text-semantic-destructive",
                  )}
                >
                  {row.overGrants}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.underGrants}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {seconds(row.medianMs)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {seconds(row.p90Ms)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {`$${row.costPer1kUsd.toFixed(2)}`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Disagreements
        label={t("misses", { count: contested.length })}
        count={contested.length}
      >
        {contested.map((item) => (
          <div key={item.message} className="space-y-2 px-3 py-3">
            <p className="text-xs">“{item.message}”</p>
            {item.previousReply ? (
              <p className="text-muted-foreground text-xs">
                {t("Router.after", { reply: item.previousReply })}
              </p>
            ) : null}
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("Router.want")}</dt>
                <dd className="font-mono">{item.want}</dd>
              </div>
              {Object.entries(item.answers).map(([classifier, outcomes]) => (
                <div key={classifier} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground font-mono">
                    {shortModel(classifier)}
                  </dt>
                  <dd>
                    <VerdictRun values={outcomes} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </Disagreements>
    </RunFrame>
  );
}

async function Section({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <section className="bg-background rounded-lg border">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold leading-5">{title}</h2>
        <p className="text-muted-foreground text-xs">{description}</p>
      </header>
      <div className="space-y-6 p-4">
        {empty ? (
          <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

async function EarlierRuns({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const t = await getTranslations("App.Admin.SokoBots.Evaluations");
  if (count === 0) return null;
  return (
    <details className="rounded-md border">
      <summary className="text-muted-foreground cursor-pointer select-none px-3 py-2 text-xs">
        {t("earlierRuns", { count })}
      </summary>
      <div className="space-y-6 border-t p-3">{children}</div>
    </details>
  );
}

export async function JudgeEvaluations({
  runs,
  currentModel,
}: {
  runs: AdminSokoBotJudgeEvaluation[];
  currentModel: string;
}) {
  const t = await getTranslations("App.Admin.SokoBots.Evaluations");
  const [latest, ...earlier] = runs;
  return (
    <Section
      title={t("Judge.title")}
      description={t("Judge.description", { model: shortModel(currentModel) })}
      empty={latest ? null : t("empty")}
    >
      {latest ? (
        <JudgeRun run={latest} latest currentModel={currentModel} />
      ) : null}
      <EarlierRuns count={earlier.length}>
        {earlier.map((run) => (
          <JudgeRun
            key={run.id}
            run={run}
            latest={false}
            currentModel={currentModel}
          />
        ))}
      </EarlierRuns>
    </Section>
  );
}

export async function RouterEvaluations({
  runs,
  currentModel,
}: {
  runs: AdminSokoBotRouterEvaluation[];
  currentModel: string;
}) {
  const t = await getTranslations("App.Admin.SokoBots.Evaluations");
  const [latest, ...earlier] = runs;
  return (
    <Section
      title={t("Router.title")}
      description={t("Router.description")}
      empty={latest ? null : t("empty")}
    >
      {latest ? (
        <RouterRun run={latest} latest currentModel={currentModel} />
      ) : null}
      <EarlierRuns count={earlier.length}>
        {earlier.map((run) => (
          <RouterRun
            key={run.id}
            run={run}
            latest={false}
            currentModel={currentModel}
          />
        ))}
      </EarlierRuns>
    </Section>
  );
}
