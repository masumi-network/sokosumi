"use client";

import {
  Clapperboard,
  Ellipsis,
  Globe2,
  House,
  Images,
  Shirt,
  ShoppingBag,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { StudioBrief } from "./studio-templates";

const CREATIVE_STARTS = [
  {
    id: "product",
    icon: ShoppingBag,
    aspectRatio: "1:1",
    prompt:
      "Create an e-commerce hero image for [product]. Show its real materials, proportions and packaging clearly on a clean backdrop. Leave space for [approved headline].",
  },
  {
    id: "campaign",
    icon: Sparkles,
    aspectRatio: "16:9",
    prompt:
      "Develop a campaign key visual for [brand or launch] aimed at [audience]. Make [campaign idea] the focus and leave space for [approved tagline].",
  },
  {
    id: "architecture",
    icon: House,
    aspectRatio: "16:9",
    prompt:
      "Create an architectural or interior concept for [space]. Show [materials and design details] in [light or time of day], with a clear sense of scale.",
  },
  {
    id: "portfolio",
    icon: Images,
    aspectRatio: "4:5",
    prompt:
      "Create a portfolio piece exploring [subject or theme]. Use [medium or visual style] and [palette] to express [idea].",
  },
  {
    id: "social",
    icon: ThumbsUp,
    aspectRatio: "4:5",
    prompt:
      "Create a social post or thumbnail for [topic or offer] on [channel]. Use one clear focal point and make [short headline] readable at small sizes.",
  },
  {
    id: "video",
    icon: Clapperboard,
    aspectRatio: "16:9",
    prompt:
      "Create a storyboard for a short video about [subject]. Show the opening, main action and closing shot in three panels with consistent subjects and lighting.",
  },
  {
    id: "fashion",
    icon: Shirt,
    aspectRatio: "4:5",
    prompt:
      "Create a fashion editorial for [collection or look] in [setting]. Use [lighting and styling direction] and keep garment details accurate.",
  },
  {
    id: "worlds",
    icon: Globe2,
    aspectRatio: "16:9",
    prompt:
      "Create concept art for [character, environment or world]. Show [defining details] with [mood, palette and visual style].",
  },
  {
    id: "other",
    icon: Ellipsis,
  },
] as const;

export function StudioCreativeStart({
  onApplyBrief,
  onFocusPrompt,
}: {
  onApplyBrief: (brief: StudioBrief) => void;
  onFocusPrompt: () => void;
}) {
  const t = useTranslations("App.Studio.CreativeStart");
  const picked = useRef(false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* Default size: it sits beside the project scope buttons in the empty state. */}
        <Button type="button" variant="outline">
          <Sparkles aria-hidden />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-3xl"
        onCloseAutoFocus={(event) => {
          if (!picked.current) return;
          picked.current = false;
          event.preventDefault();
          onFocusPrompt();
        }}
      >
        <DialogHeader className="pe-8">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 min-[380px]:grid-cols-2 md:grid-cols-3">
          {CREATIVE_STARTS.map(({ icon: Icon, ...start }) => (
            <DialogClose asChild key={start.id}>
              <Button
                className="h-auto min-h-24 flex-col gap-2 px-3 py-4 text-center whitespace-normal"
                onClick={() => {
                  picked.current = true;
                  if ("prompt" in start) onApplyBrief(start);
                }}
                type="button"
                variant="outline"
              >
                <Icon aria-hidden className="size-5" />
                {t(start.id)}
              </Button>
            </DialogClose>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
