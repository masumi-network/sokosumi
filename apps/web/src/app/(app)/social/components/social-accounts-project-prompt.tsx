"use client";

import { ChevronDown, FolderKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { openScopeCreate } from "@/app/components/project-scope/sidebar-project-scope-state";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const NEED_PROJECT_COPY = {
  accounts: "accountsNeedProject",
  attention: "attentionNeedProject",
  drafts: "draftsNeedProject",
} as const;

interface SocialAccountsProjectPromptProps {
  kind?: keyof typeof NEED_PROJECT_COPY;
  notice?: string;
}

/** Project-owned accounts and drafts start with the same menu as Content Studio. */
export function SocialAccountsProjectPrompt({
  kind = "accounts",
  notice,
}: SocialAccountsProjectPromptProps) {
  const copy = NEED_PROJECT_COPY[kind];
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

function SocialPlatformCard({
  comingSoonLabel,
  provider,
}: {
  comingSoonLabel: string;
  provider: (typeof SOCIAL_PROVIDERS)[number];
}) {
  return (
    <div className="bg-card flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl border px-3 py-5">
      <provider.Icon className="size-8" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{provider.name}</p>
        {"comingSoon" in provider ? (
          <p className="text-muted-foreground text-xs">{comingSoonLabel}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Same -50% CSS loop as the auth customer logos. Always on this empty state. */
function SocialPlatformCarousel() {
  const t = useTranslations("App.Social");
  const accounts = useTranslations("App.Projects.ProjectSocialAccounts");
  const comingSoonLabel = accounts("comingSoon");

  return (
    <section
      aria-label={t("platforms.label")}
      className="group relative w-full"
      data-testid="social-platform-marquee"
    >
      <button
        type="button"
        className="sr-only rounded-sm text-xs focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-20 focus:bg-background focus:px-1.5 focus:py-0.5 focus:ring-2 focus:ring-ring"
      >
        {t("platforms.pause")}
      </button>
      <div
        className="@container relative overflow-x-auto overflow-y-hidden rounded-2xl outline-none motion-safe:overflow-x-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="social-platform-marquee-track"
        tabIndex={0}
      >
        <div
          aria-hidden
          className="from-background pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-linear-to-r to-transparent"
        />
        <div
          aria-hidden
          className="from-background pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l to-transparent"
        />
        <div className="-ml-3 flex w-max motion-safe:animate-social-platform-marquee motion-safe:group-active:[animation-play-state:paused] motion-safe:group-focus-within:[animation-play-state:paused] motion-safe:[@media(hover:hover)]:group-hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              aria-hidden={copy === 1 || undefined}
              inert={copy === 1 || undefined}
              className={
                copy === 1
                  ? "flex shrink-0 motion-reduce:hidden"
                  : "flex shrink-0"
              }
            >
              {SOCIAL_PROVIDERS.map((provider) => (
                <li
                  key={`${provider.id}-${copy}`}
                  className="w-[40cqw] shrink-0 pl-3 sm:w-[calc(100cqw/3)] lg:w-[calc(100cqw/6)]"
                >
                  <SocialPlatformCard
                    comingSoonLabel={comingSoonLabel}
                    provider={provider}
                  />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
