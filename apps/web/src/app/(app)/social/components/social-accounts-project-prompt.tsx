"use client";

import { ChevronDown, FolderKanban } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { openScopeCreate } from "@/app/components/project-scope/sidebar-project-scope-state";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SocialAccountsProjectPromptProps {
  kind?: "accounts" | "drafts" | "statistics";
  notice?: string;
}

/** Project-owned accounts and drafts start with the same menu as Content Studio. */
export function SocialAccountsProjectPrompt({
  kind = "accounts",
  notice,
}: SocialAccountsProjectPromptProps) {
  const copy =
    kind === "drafts"
      ? "draftsNeedProject"
      : kind === "statistics"
        ? "statisticsNeedProject"
        : "accountsNeedProject";
  const t = useTranslations("App.Social");
  const router = useRouter();
  const { projectId, switchHref } = useProjectScope();
  const [open, setOpen] = useState(false);

  function handleSelect(nextProjectId: string | null) {
    if (!nextProjectId) return;
    // Scope switching resets page filters. Keep the tab that asked for a project.
    router.push(`${switchHref(nextProjectId)}&tab=${kind}`);
  }

  return (
    <section
      aria-labelledby="social-accounts-heading"
      className="mx-auto flex w-full flex-col items-center px-2 py-12 text-center sm:py-20"
      data-testid="social-no-project"
    >
      {kind === "accounts" ? (
        <SocialPlatformCarousel />
      ) : (
        <span
          aria-hidden
          className="bg-background text-muted-foreground flex size-12 items-center justify-center rounded-xl border"
        >
          <FolderKanban className="size-6" />
        </span>
      )}
      <h2
        id="social-accounts-heading"
        className="mt-8 text-2xl font-light tracking-tight text-balance"
      >
        {t(`${copy}.title`)}
      </h2>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed text-pretty">
        {notice ?? t(`${copy}.body`)}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button className="mt-6 min-h-11 md:min-h-10" type="button">
            <FolderKanban className="size-4" aria-hidden />
            {t("pickProject")}
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          className="flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 motion-reduce:animate-none"
        >
          <ProjectScopeMenu
            selectedProjectId={projectId}
            includeWorkspace={false}
            onSelect={handleSelect}
            onCreate={openScopeCreate}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </section>
  );
}

function SocialPlatformCarousel() {
  const t = useTranslations("App.Social");
  const accounts = useTranslations("App.Projects.ProjectSocialAccounts");
  const reduceMotion = useReducedMotion();

  return (
    <Carousel
      aria-label={t("platforms.label")}
      className="w-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      opts={{
        align: "start",
        loop: !reduceMotion,
        breakpoints: { "(prefers-reduced-motion: reduce)": { duration: 0 } },
      }}
    >
      <CarouselContent className="-ml-3">
        {SOCIAL_PROVIDERS.map((provider) => (
          <CarouselItem
            key={provider.id}
            className="basis-2/5 pl-3 sm:basis-1/3 lg:basis-1/6"
          >
            <div className="bg-card flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl border px-3 py-5">
              <provider.Icon className="size-8" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium">{provider.name}</p>
                {"comingSoon" in provider ? (
                  <p className="text-muted-foreground text-xs">
                    {accounts("comingSoon")}
                  </p>
                ) : null}
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
  );
}
