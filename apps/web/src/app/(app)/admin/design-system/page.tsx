import { Check, Plus, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { LoadingButtonDemo } from "./loading-button-demo";
import {
  ALPHA_TONES,
  DESIGN_SYSTEM_VARS,
  GRADIENTS,
  IRIS_FLOWER,
  MOTION_TOKENS,
  NEUTRALS,
  PALETTE,
  RADII,
  type Swatch,
  THEME_ROLES,
  TYPE_ROLES,
  WEIGHTS,
} from "./tokens";

export const metadata: Metadata = {
  title: "Design system",
  description:
    "Masumi Family brand and UI rules, rendered with our components.",
};

const BRAND_GUIDE_URL =
  "https://github.com/masumi-network/Masumi-Family-Brand-Guide";

/** Paints a swatch from one of the preview's `--ds-*` custom properties. */
function backgroundFrom(cssVar: string) {
  return { background: `var(${cssVar})` };
}

interface SectionProps {
  title: string;
  lead: string;
  children: ReactNode;
}

function Section({ title, lead, children }: SectionProps) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-light tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{lead}</p>
      </div>
      {children}
    </section>
  );
}

/** The guide's middle layer: a borderless gray group holding components. */
interface PanelProps {
  className?: string;
  children: ReactNode;
}

function Panel({ className, children }: PanelProps) {
  return <div className={cn(HOLDER_CLASS, "p-3", className)}>{children}</div>;
}

interface SwatchTileProps {
  swatch: Swatch;
  tall?: boolean;
}

function SwatchTile({ swatch, tall }: SwatchTileProps) {
  return (
    <div className="space-y-2">
      <div
        className={cn("rounded-lg border", tall ? "h-24" : "h-14")}
        style={backgroundFrom(swatch.cssVar)}
      />
      <div className="text-xs font-medium">{swatch.name}</div>
      <div className="text-muted-foreground text-xs tabular-nums">
        {swatch.hex}
      </div>
    </div>
  );
}

type StatusTone = "todo" | "inProgress" | "needsInput" | "done" | "failed";

interface StatusDiscProps {
  tone: StatusTone;
}

/** Status ink on a colored disc is always Neutral 950, the guide's X color. */
const ON_STATUS = { color: "var(--ds-neutral-950)" };

function StatusDisc({ tone }: StatusDiscProps) {
  const base =
    "inline-flex size-4 shrink-0 items-center justify-center rounded-full";
  if (tone === "done") {
    return (
      <span
        className={base}
        style={{ ...backgroundFrom("--ds-positive"), ...ON_STATUS }}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (tone === "needsInput") {
    return (
      <span
        className={cn(base, "text-2xs font-semibold")}
        style={{ ...backgroundFrom("--ds-golden-yellow"), ...ON_STATUS }}
        aria-hidden
      >
        !
      </span>
    );
  }
  if (tone === "failed") {
    return (
      <span className={cn(base, "bg-secondary text-secondary-foreground")}>
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        "border-muted-foreground border-2",
        tone === "inProgress" &&
          "bg-[conic-gradient(var(--muted-foreground)_0_50%,transparent_0)]",
      )}
    />
  );
}

const STATUS_TONES: StatusTone[] = [
  "todo",
  "inProgress",
  "needsInput",
  "done",
  "failed",
];

export default async function DesignSystemPage() {
  const t = await getTranslations("App.Admin.DesignSystem");

  return (
    <div className="min-h-full w-full">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={BRAND_GUIDE_URL} target="_blank" rel="noreferrer">
                {t("guideLink")}
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin">{t("backToAdmin")}</Link>
            </Button>
          </div>
        </div>

        <div style={{ ...DESIGN_SYSTEM_VARS }} className="space-y-16">
          <Section title={t("Color.title")} lead={t("Color.lead")}>
            <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
              <div
                className="text-primary-foreground flex min-h-48 flex-col justify-between rounded-2xl p-6"
                style={backgroundFrom(IRIS_FLOWER.cssVar)}
              >
                <span className="text-sm font-medium">
                  {t("Color.primaryName")}
                </span>
                <span className="text-4xl font-light tracking-tight">
                  {IRIS_FLOWER.hex}
                </span>
              </div>
              <Panel className="space-y-3">
                <p className="text-sm font-semibold">
                  {t("Color.primaryRuleTitle")}
                </p>
                <p className="text-sm">{t("Color.primaryRule")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary">{t("Components.schedule")}</Button>
                </div>
              </Panel>
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold">{t("Color.palette")}</h3>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
                {PALETTE.map((swatch) => (
                  <SwatchTile key={swatch.cssVar} swatch={swatch} tall />
                ))}
              </div>
              <p className="text-muted-foreground text-sm">
                {t("Color.paletteRule")}
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
              <div className="space-y-3">
                <h3 className="text-base font-semibold">
                  {t("Color.neutrals")}
                </h3>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {NEUTRALS.map((swatch) => (
                    <SwatchTile key={swatch.cssVar} swatch={swatch} />
                  ))}
                </div>
                <h3 className="pt-3 text-base font-semibold">
                  {t("Color.alpha")}
                </h3>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                  {ALPHA_TONES.map((tone) => (
                    <div key={tone.cssVar} className="space-y-2">
                      <div
                        className="h-10 rounded-lg border"
                        style={backgroundFrom(tone.cssVar)}
                      />
                      <div className="text-xs">
                        {t("Color.alphaStep", { step: tone.step })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("Color.alphaRule")}
                </p>
              </div>
              <div className="space-y-3">
                <h3 className="text-base font-semibold">{t("Color.roles")}</h3>
                <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-x-3 gap-y-2 text-sm">
                  <span />
                  <span className="text-muted-foreground text-xs">
                    {t("Theme.light")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("Theme.dark")}
                  </span>
                  {THEME_ROLES.map((role) => (
                    <RoleRow
                      key={role.key}
                      label={t(`Color.Roles.${role.key}`)}
                      light={role.light}
                      dark={role.dark}
                    />
                  ))}
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("Color.darkPrimaryRule")}
                </p>
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-base font-semibold">{t("Color.status")}</h3>
                <Panel className="grid grid-cols-3 gap-3">
                  {(["done", "needsInput", "failed"] as const).map((tone) => (
                    <div
                      key={tone}
                      className="bg-card space-y-2 rounded-lg border p-3"
                    >
                      <StatusDisc tone={tone} />
                      <div className="text-sm font-semibold">
                        {t(`Color.Status.${tone}`)}
                      </div>
                    </div>
                  ))}
                </Panel>
                <p className="text-muted-foreground text-sm">
                  {t("Color.statusRule")}
                </p>
              </div>
              <div className="space-y-3">
                <h3 className="text-base font-semibold">
                  {t("Color.gradients")}
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {GRADIENTS.map((gradient) => (
                    <div
                      key={gradient.key}
                      className="h-24 rounded-xl"
                      style={{ background: gradient.value }}
                    />
                  ))}
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("Color.gradientRule")}
                </p>
              </div>
            </div>
          </Section>

          <Section title={t("Type.title")} lead={t("Type.lead")}>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {WEIGHTS.map((weight) => (
                <div key={weight.key} className="space-y-1">
                  <div className={cn("text-4xl", weight.className)}>
                    {t("Type.specimenGlyph")}
                  </div>
                  <div className="text-sm font-medium">
                    {t(`Type.Weights.${weight.key}`)} · {weight.value}
                  </div>
                </div>
              ))}
            </div>
            <div className="divide-y border-y">
              {TYPE_ROLES.map((role) => (
                <div
                  key={role.key}
                  className="grid grid-cols-[8rem_1fr] items-baseline gap-4 py-3"
                >
                  <span className="text-muted-foreground text-xs">
                    {t(`Type.Roles.${role.key}`)}
                  </span>
                  <span className={role.className}>{t("Type.sample")}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t("Shape.title")} lead={t("Shape.lead")}>
            <div className="grid gap-8 md:grid-cols-2">
              <div className="grid grid-cols-4 gap-3">
                {RADII.map((radius) => (
                  <div key={radius.key} className="space-y-2">
                    <div
                      className={cn("bg-muted h-12 border", radius.className)}
                    />
                    <span className="text-xs font-medium">
                      {radius.key}
                      {radius.px === null ? "" : ` · ${radius.px}`}
                    </span>
                  </div>
                ))}
              </div>
              <Panel className="grid grid-cols-2 gap-3">
                <div className="bg-card flex h-20 items-end rounded-lg border p-3 text-xs font-medium">
                  {t("Shape.border")}
                </div>
                <div className="bg-card flex h-20 items-end rounded-lg border p-3 text-xs font-medium shadow-lg">
                  {t("Shape.overlay")}
                </div>
              </Panel>
            </div>
          </Section>

          <Section title={t("Components.title")} lead={t("Components.lead")}>
            <Panel className="flex flex-wrap items-center gap-3">
              <Button variant="primary">{t("Components.schedule")}</Button>
              <Button variant="outline">{t("Components.duplicate")}</Button>
              <Button variant="ghost">{t("Components.cancel")}</Button>
              <Button variant="destructive">
                <X />
                {t("Components.delete")}
              </Button>
              {/* Iris Flower never sets text on a white page, so links take the
                  text color here. The app-wide migration remaps `link`. */}
              <Button variant="link" className="text-foreground">
                {t("Components.showAll")}
              </Button>
              <Button variant="outline" size="sm">
                {t("Components.small")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("Components.addTask")}
              >
                <Plus />
              </Button>
              <LoadingButtonDemo label={t("Components.saving")} />
            </Panel>

            <Panel className="grid gap-4 md:grid-cols-3">
              <div className="bg-card space-y-5 rounded-lg border p-5 md:col-span-2">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ds-post-title">
                      {t("Components.postTitle")}
                    </Label>
                    <Input
                      id="ds-post-title"
                      placeholder={t("Components.postTitlePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ds-budget">{t("Components.budget")}</Label>
                    <Input
                      id="ds-budget"
                      defaultValue="-20"
                      aria-invalid
                      aria-describedby="ds-budget-error"
                    />
                    <p
                      id="ds-budget-error"
                      className="flex items-center gap-1.5 text-sm"
                    >
                      <X className="size-3.5" />
                      {t("Components.budgetError")}
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-card space-y-5 rounded-lg border p-5">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="ds-notify">{t("Components.notify")}</Label>
                  <Switch id="ds-notify" defaultChecked />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="ds-review" />
                  <Label htmlFor="ds-review">{t("Components.review")}</Label>
                </div>
                <Tabs defaultValue="calendar">
                  <TabsList>
                    <TabsTrigger value="calendar">
                      {t("Components.calendar")}
                    </TabsTrigger>
                    <TabsTrigger value="drafts">
                      {t("Components.drafts")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </Panel>

            <Panel className="grid gap-4 md:grid-cols-3">
              <Card className="gap-3 p-5">
                <Badge variant="outline">
                  <StatusDisc tone="needsInput" />
                  {t("States.needsInput")}
                </Badge>
                <p className="font-semibold">{t("Components.cardTitle")}</p>
                <p className="text-muted-foreground text-sm">
                  {t("Components.cardBody")}
                </p>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm">
                    {t("Components.answer")}
                  </Button>
                  <Button variant="ghost" size="sm">
                    {t("Components.openTask")}
                  </Button>
                </div>
              </Card>
              <div className="bg-card divide-y self-start rounded-xl border">
                {STATUS_TONES.map((tone) => (
                  <div
                    key={tone}
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <StatusDisc tone={tone} />
                    {t(`States.${tone}`)}
                  </div>
                ))}
              </div>
              {/* Toasts and dialogs render in a portal outside the token
                  scope, so these two are static specimens of the same
                  surfaces. */}
              <div className="space-y-3">
                <div
                  role="status"
                  className="bg-card flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
                >
                  <StatusDisc tone="done" />
                  <span className="flex-1">{t("Components.toast")}</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-foreground h-auto p-0"
                  >
                    {t("Components.undo")}
                  </Button>
                </div>
                <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-xl border">
                  <div className="bg-overlay absolute inset-0" />
                  <div className="bg-popover relative w-64 space-y-2 rounded-lg border p-5 shadow-lg">
                    <p className="font-semibold">
                      {t("Components.dialogTitle")}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {t("Components.dialogBody")}
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="ghost" size="sm">
                        {t("Components.cancel")}
                      </Button>
                      <Button variant="destructive" size="sm">
                        {t("Components.deleteDrafts")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </Section>

          <Section title={t("Motion.title")} lead={t("Motion.lead")}>
            <div className="grid grid-cols-2 gap-6 border-y py-6">
              {MOTION_TOKENS.map((token) => (
                <div key={token.key} className="space-y-1">
                  <div className="text-2xl font-light tabular-nums">
                    {token.duration}
                  </div>
                  <div className="text-sm font-semibold">
                    {t(`Motion.${token.key}.title`)}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t(`Motion.${token.key}.body`)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-sm">{t("Motion.rules")}</p>
          </Section>

          <Section title={t("States.title")} lead={t("States.lead")}>
            <Panel className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-card space-y-3 rounded-xl border p-5">
                <p className="text-sm font-medium">{t("States.loading")}</p>
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-16 w-full" />
              </div>
              <div className="bg-card flex flex-col items-center gap-2 rounded-xl border p-5 text-center">
                <p className="font-semibold">{t("States.emptyTitle")}</p>
                <p className="text-muted-foreground text-sm">
                  {t("States.emptyBody")}
                </p>
                <Button variant="primary" size="sm" className="mt-2">
                  {t("States.emptyAction")}
                </Button>
              </div>
              <div
                role="alert"
                className="bg-card space-y-2 rounded-xl border p-5"
              >
                <div className="flex items-center gap-2">
                  <StatusDisc tone="failed" />
                  <p className="text-sm font-semibold">
                    {t("States.errorTitle")}
                  </p>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("States.errorBody")}
                </p>
                <Button variant="outline" size="sm">
                  {t("States.errorAction")}
                </Button>
              </div>
              <div className="bg-card space-y-2 rounded-xl border p-5">
                <div className="flex items-center gap-2">
                  <StatusDisc tone="done" />
                  <p className="text-sm font-semibold">
                    {t("States.doneTitle")}
                  </p>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("States.doneBody")}
                </p>
                <Button variant="outline" size="sm">
                  {t("States.doneAction")}
                </Button>
              </div>
            </Panel>
          </Section>
        </div>
      </div>
    </div>
  );
}

interface RoleRowProps {
  label: string;
  light: string;
  dark: string;
}

function RoleRow({ label, light, dark }: RoleRowProps) {
  return (
    <>
      <span>{label}</span>
      <span className="h-6 rounded-md border" style={backgroundFrom(light)} />
      <span className="h-6 rounded-md border" style={backgroundFrom(dark)} />
    </>
  );
}
