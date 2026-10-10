import { ChevronDown, FolderKanban } from "lucide-react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SOCIAL_TAB_TRIGGER_CLASS_NAME,
  SOCIAL_TABS,
  SOCIAL_TABS_LIST_CLASS_NAME,
} from "@/app/projects/components/social-posts/constants";
import { Button } from "@/components/ui/button";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import en from "../messages/en.json";

const showAttention = process.argv[2] !== "before";
const tabs = showAttention
  ? SOCIAL_TABS
  : SOCIAL_TABS.filter((tab) => tab !== "attention");
const active = showAttention ? "attention" : "calendar";

function WorkspaceTabsShot() {
  const sections = useTranslations("App.Projects.SocialPosts.sections");
  const social = useTranslations("App.Social");

  return (
    <div className="w-[52rem] space-y-4" data-testid="attention-need-project">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            SEGMENTED_TABS_LIST_CLASS_NAME,
            SOCIAL_TABS_LIST_CLASS_NAME,
          )}
        >
          {tabs.map((tab) => (
            <span
              key={tab}
              className={cn(
                SEGMENTED_TAB_TRIGGER_CLASS_NAME,
                SOCIAL_TAB_TRIGGER_CLASS_NAME,
                "inline-flex items-center justify-center",
                tab === active && "bg-background text-foreground shadow-sm",
              )}
            >
              {sections(tab)}
            </span>
          ))}
        </div>
        <Button type="button">New post</Button>
      </div>
      {showAttention ? (
        <section className="mx-auto flex w-full flex-col items-center px-2 py-12 text-center sm:py-20">
          <span
            aria-hidden
            className="bg-background text-muted-foreground flex size-12 items-center justify-center rounded-xl border"
          >
            <FolderKanban className="size-6" />
          </span>
          <h2 className="mt-8 text-2xl font-light tracking-tight text-balance">
            {social("attentionNeedProject.title")}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed text-pretty">
            {social("attentionNeedProject.body")}
          </p>
          <Button className="mt-6 min-h-11 md:min-h-10" type="button">
            <FolderKanban className="size-4" aria-hidden />
            {social("pickProject")}
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </section>
      ) : (
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-sm">October 2026</p>
          <div className="mt-3 grid grid-cols-7 gap-2 text-center text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="text-muted-foreground">
                {day}
              </div>
            ))}
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="bg-card rounded-md border px-2 py-6">
                {index + 5}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkspaceTabsShot />
    </NextIntlClientProvider>,
  ),
);
