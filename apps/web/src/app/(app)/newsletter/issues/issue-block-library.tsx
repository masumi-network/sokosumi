"use client";

import type { NewsletterBlock } from "@sokosumi/utils";
import {
  Columns2,
  Heading,
  ImageIcon,
  type LucideIcon,
  Minus,
  MoveVertical,
  PanelBottom,
  RectangleHorizontal,
  Share2,
  Type,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

const BLOCK_ICONS: Record<NewsletterBlock["type"], LucideIcon> = {
  heading: Heading,
  text: Type,
  image: ImageIcon,
  button: RectangleHorizontal,
  columns: Columns2,
  social: Share2,
  divider: Minus,
  spacer: MoveVertical,
  footer: PanelBottom,
};

export function BlockIcon({ type }: { type: NewsletterBlock["type"] }) {
  const Icon = BLOCK_ICONS[type];
  return <Icon className="text-muted-foreground size-4 shrink-0" />;
}

/** An empty block of each type, ready to fill in. */
export function newBlock(
  type: NewsletterBlock["type"],
  buttonLabel: string,
): NewsletterBlock {
  switch (type) {
    case "heading":
      return { type, text: "", level: 2 };
    case "text":
    case "footer":
      return { type, text: "" };
    case "image":
      return { type, url: "", alt: "" };
    case "button":
      return { type, label: buttonLabel, url: "" };
    case "divider":
      return { type };
    case "columns":
      return { type, columns: [{ text: "" }, { text: "" }] };
    case "spacer":
      return { type, size: "md" };
    case "social":
      return { type, links: [{ network: "website", url: "" }] };
  }
}

/** Every block type in one visible grid, so adding is one click. */
export function IssueBlockLibrary({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: NewsletterBlock["type"]) => void;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  return (
    <section
      aria-labelledby="newsletter-block-library"
      className={cn(HOLDER_ITEM_CLASS, "@container min-w-0 space-y-3 p-4")}
    >
      <h4 id="newsletter-block-library" className="text-sm font-medium">
        {t("addBlock")}
      </h4>
      <ul className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-5">
        {(Object.keys(BLOCK_ICONS) as NewsletterBlock["type"][]).map((type) => {
          const Icon = BLOCK_ICONS[type];
          return (
            <li key={type} className="min-w-0">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={disabled}
                onClick={() => onAdd(type)}
              >
                <Icon />
                <span className="truncate">{t(`blockTypes.${type}`)}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
