"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  onActivate: () => void;
}

const HERMES_ASCII = String.raw`
██╗  ██╗███████╗██████╗ ███╗   ███╗███████╗███████╗
██║  ██║██╔════╝██╔══██╗████╗ ████║██╔════╝██╔════╝
███████║█████╗  ██████╔╝██╔████╔██║█████╗  ███████╗
██╔══██║██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══╝  ╚════██║
██║  ██║███████╗██║  ██║██║ ╚═╝ ██║███████╗███████║
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚══════╝
`.trim();

const FEATURES: Array<{ titleKey: string; bodyKey: string }> = [
  { titleKey: "feature1Title", bodyKey: "feature1Body" },
  { titleKey: "feature2Title", bodyKey: "feature2Body" },
  { titleKey: "feature3Title", bodyKey: "feature3Body" },
  { titleKey: "feature4Title", bodyKey: "feature4Body" },
  { titleKey: "feature5Title", bodyKey: "feature5Body" },
  { titleKey: "feature6Title", bodyKey: "feature6Body" },
];

export default function EmptyState({ onActivate }: EmptyStateProps) {
  const t = useTranslations("App.Hermes.EmptyState");
  const tBeta = useTranslations("App.Hermes");

  return (
    <div className="text-foreground mx-auto w-full max-w-4xl px-4 py-12 font-mono md:py-16">
      {/* ── Top frame: path label + beta tag ───────────────────── */}
      <div className="text-tertiary-foreground mb-6 flex items-center justify-between text-[11px] tracking-wide">
        <span>┌─[ /hermes ]</span>
        <span className="border-border/60 rounded-sm border px-1.5 py-0 text-[10px] uppercase tracking-widest">
          {tBeta("BetaTag")}
        </span>
      </div>

      {/* ── ASCII banner ──────────────────────────────────────── */}
      <div className="border-border/60 bg-muted/10 overflow-x-auto rounded-md border p-4 md:p-6">
        <pre
          aria-label="Hermes"
          className="text-foreground inline-block text-[8px] leading-[1.05] font-bold tracking-tight whitespace-pre select-none md:text-[11px]"
        >
          {HERMES_ASCII}
        </pre>
        <div className="text-muted-foreground mt-4 flex items-baseline gap-1.5 text-xs">
          <span className="text-tertiary-foreground">{">"}</span>
          <span>{t("subtitle").toLowerCase()}</span>
          <BlinkingCursor />
        </div>
      </div>

      {/* ── Description ───────────────────────────────────────── */}
      <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-relaxed">
        {t("description")}
      </p>

      {/* ── CTAs (terminal-style brackets) ────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <BracketButton onClick={onActivate} variant="primary">
          activate hermes
        </BracketButton>
        <BracketButton
          as="a"
          href="https://hermes-agent.nousresearch.com/"
          target="_blank"
          rel="noreferrer noopener"
          variant="ghost"
        >
          {t("secondaryCta").toLowerCase()} ↗
        </BracketButton>
      </div>

      {/* ── Capabilities ──────────────────────────────────────── */}
      <SectionDivider label="capabilities" />

      <ol className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        {FEATURES.map(({ titleKey, bodyKey }, idx) => {
          const num = String(idx + 1).padStart(2, "0");
          return (
            <li key={titleKey} className="flex gap-3 text-sm">
              <span className="text-tertiary-foreground tabular-nums">
                [{num}]
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-foreground font-semibold">
                  {t(titleKey).toLowerCase()}
                </span>
                <span className="text-muted-foreground text-xs leading-relaxed">
                  {t(bodyKey)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── Sokosumi integration ──────────────────────────────── */}
      <SectionDivider label="sokosumi integration" />

      <div className="mt-4 flex gap-3 text-sm">
        <span className="text-tertiary-foreground">{">"}</span>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          {t("sokosumiBody")}
        </p>
      </div>

      {/* ── Bottom frame: footnote + powered-by ───────────────── */}
      <div className="text-tertiary-foreground mt-12 border-t pt-4">
        <p className="text-xs leading-relaxed">{t("footnote").toLowerCase()}</p>
        <div className="mt-3 flex items-center justify-between text-[11px] tracking-wide">
          <span>└─[ {t("poweredBy").toLowerCase()} ]</span>
          <span>v0.1 · beta</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function BlinkingCursor() {
  return (
    <span
      aria-hidden
      className="bg-foreground inline-block h-[0.85em] w-[0.5em] animate-pulse"
    />
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="text-tertiary-foreground mt-10 flex items-center gap-3 text-xs">
      <span>{">"}</span>
      <span className="font-semibold tracking-wide">{label}</span>
      <span className="border-border/60 flex-1 border-t" aria-hidden />
    </div>
  );
}

interface BracketButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  as?: "button" | "a";
  href?: string;
  target?: string;
  rel?: string;
}

function BracketButton({
  children,
  onClick,
  variant = "primary",
  as = "button",
  href,
  target,
  rel,
}: BracketButtonProps) {
  const isPrimary = variant === "primary";

  const baseClass = cn(
    "group inline-flex items-center gap-1.5 font-mono font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isPrimary
      ? "bg-foreground text-background hover:bg-foreground/90 px-4 py-2.5 text-sm uppercase tracking-wide rounded-sm shadow-sm"
      : "text-tertiary-foreground hover:text-foreground px-1 py-1 text-sm rounded-sm",
  );

  const content = isPrimary ? (
    <>
      <span className="text-background/60 group-hover:text-background transition-colors">
        [
      </span>
      <span aria-hidden className="text-background/70">
        ▸
      </span>
      <span className="font-semibold tracking-[0.08em]">{children}</span>
      <span className="text-background/60 group-hover:text-background transition-colors">
        ]
      </span>
    </>
  ) : (
    <>
      <span className="text-tertiary-foreground/60 group-hover:text-foreground transition-colors">
        [
      </span>
      <span className="underline-offset-4 group-hover:underline decoration-foreground/40">
        {children}
      </span>
      <span className="text-tertiary-foreground/60 group-hover:text-foreground transition-colors">
        ]
      </span>
    </>
  );

  if (as === "a") {
    return (
      <a href={href} target={target} rel={rel} className={baseClass}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={baseClass}>
      {content}
    </button>
  );
}
