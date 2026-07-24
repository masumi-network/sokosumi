"use client";

import { ArrowRight, ListTodo, Mail, Repeat, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentType, useContext, useState } from "react";

import { AssistantOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { EmptyStateSeedContext } from "./demo-orb";

type ExampleKey = "example1" | "example3" | "example4";

export const EXAMPLES: Array<{
  key: ExampleKey;
  /** i18n key for the mocked Hermes reply (markdown-lite). */
  replyKey: `${ExampleKey}Reply`;
  categoryKey: ExampleKey;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  {
    key: "example1",
    replyKey: "example1Reply",
    categoryKey: "example1",
    Icon: Mail,
  },
  {
    key: "example3",
    replyKey: "example3Reply",
    categoryKey: "example3",
    Icon: Repeat,
  },
  {
    key: "example4",
    replyKey: "example4Reply",
    categoryKey: "example4",
    Icon: ListTodo,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Things to try — click-through carousel.
//
// Pills along the top let the user pick a prompt category; the canvas below
// renders the prompt as a user message + a mock Hermes reply so the visitor
// sees what the agent would actually do, not just a quoted string. Mock
// replies live in en.json and use a tiny markdown subset (**bold** + bullet
// lines starting with `• ` or `1.`).

export function ExamplesCarousel({ onActivate }: { onActivate: () => void }) {
  const seed = useContext(EmptyStateSeedContext);
  const t = useTranslations("App.Hermes.EmptyState");
  const tCommon = useTranslations("App.Hermes.Common");
  const [activeKey, setActiveKey] = useState<ExampleKey>(EXAMPLES[0]!.key);
  const active = EXAMPLES.find((e) => e.key === activeKey) ?? EXAMPLES[0]!;

  return (
    <div className="flex flex-col gap-4">
      {/* Pills — horizontally scrollable on narrow viewports */}
      <div className="-mx-2 overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-2">
          {EXAMPLES.map(({ key, categoryKey, Icon }) => {
            const isActive = key === activeKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveKey(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:border-foreground/25 hover:bg-muted/40",
                )}
                aria-pressed={isActive}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{t(`exampleCategories.${categoryKey}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div
        key={active.key}
        className="bg-muted/30 border-border/50 animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-4 rounded-xl border p-5 duration-200 md:p-6"
      >
        {/* User prompt — capped at a chat-plausible measure so it reads as
            a message, not a purple banner out-shouting the CTA. */}
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground max-w-[75%] rounded-xl rounded-tr-md px-4 py-2.5 text-sm font-medium leading-snug md:max-w-xl">
            {t(active.key)}
          </div>
        </div>

        {/* Hermes reply */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-card border-border ring-background relative mt-0.5 size-8 shrink-0 overflow-hidden rounded-full border ring-2"
          >
            <AssistantOrb
              seed={seed}
              animate={false}
              size={64}
              expression="happy"
              className="size-full"
            />
          </span>
          <div className="border-border/60 bg-background/60 min-w-0 flex-1 rounded-xl rounded-tl-md border px-4 py-3">
            <div className="text-tertiary-foreground mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
              <Sparkles className="size-3" aria-hidden />
              <span>{tCommon("hermesAvatarAlt")}</span>
            </div>
            <MockMarkdown text={t(active.replyKey)} />
          </div>
        </div>
      </div>

      {/* Quiet mid-page action — catches users at the moment the mock
          reply convinces them; outline keeps the filled purple reserved
          for the hero and the close. */}
      <div className="mt-1 flex justify-center">
        <Button variant="outline" className="group gap-2" onClick={onActivate}>
          <span>{t("primaryCta")}</span>
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
      </div>
    </div>
  );
}

/**
 * Tiny renderer for the mock replies. Splits on blank lines into blocks,
 * detects bullet (`• `) and numbered (`1. `) lists, and replaces `**…**`
 * inline with `<strong>`. Just enough markdown to make the mocks readable
 * without pulling in a real parser for a marketing string.
 */
function MockMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className="text-foreground flex flex-col gap-3 text-sm leading-relaxed">
      {blocks.map((block, blockIdx) => {
        const lines = block.split("\n");
        const isBulletList = lines.every((l) => l.trim().startsWith("• "));
        const isNumberedList = lines.every((l) => /^\s*\d+\.\s/.test(l));

        if (isBulletList) {
          return (
            <ul key={blockIdx} className="flex flex-col gap-1.5 pl-1">
              {lines.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="text-muted-foreground/60 mt-0.5">
                    •
                  </span>
                  <span className="flex-1">
                    <InlineBold text={line.replace(/^•\s+/, "")} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={blockIdx} className="flex flex-col gap-1.5 pl-1">
              {lines.map((line, i) => {
                const match = line.match(/^\s*(\d+)\.\s+(.*)$/);
                if (!match) return null;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground/70 tabular-nums">
                      {match[1]}.
                    </span>
                    <span className="flex-1">
                      <InlineBold text={match[2]!} />
                    </span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Treat lines starting with `> ` as a quoted block (the draft reply).
        if (lines.every((l) => l.trim().startsWith(">"))) {
          return (
            <blockquote
              key={blockIdx}
              className="border-border bg-muted/30 text-foreground/90 rounded-md border-l-2 px-3 py-2 italic"
            >
              {lines.map((l, i) => (
                <div key={i}>
                  <InlineBold text={l.replace(/^>\s?/, "")} />
                </div>
              ))}
            </blockquote>
          );
        }

        return (
          <p key={blockIdx} className="text-foreground">
            {lines.map((line, i) => (
              <span key={i}>
                <InlineBold text={line} />
                {i < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const bold = part.startsWith("**") && part.endsWith("**");
        if (bold) {
          return (
            <strong key={i} className="text-foreground font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
