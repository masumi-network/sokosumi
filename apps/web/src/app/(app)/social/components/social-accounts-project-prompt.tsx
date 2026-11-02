"use client";

import { CircleAlert, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import {
  type SOCIAL_PROVIDERS,
  socialProvidersEnabledFirst,
} from "@/components/social-providers";
import { Badge } from "@/components/ui/badge";
import { useSocialProviderAvailability } from "@/contexts/social-provider-availability-context";
import { cn } from "@/lib/utils";

const NEED_PROJECT_COPY = {
  accounts: "accountsNeedProject",
  attention: "attentionNeedProject",
  drafts: "draftsNeedProject",
} as const;

interface SocialAccountsProjectPromptProps {
  kind?: keyof typeof NEED_PROJECT_COPY;
  notice?: string;
  /**
   * Open the header's project selector on arrival. Off where the prompt sits
   * above a view that works without a project, as the calendar does.
   */
  autoOpen?: boolean;
}

/**
 * Project-owned accounts and drafts ask for a project through the header's
 * own selector, as Content Studio does, over a backdrop of what the tab holds:
 * the platforms to connect for Accounts, a post fan for Drafts and Attention.
 */
export function SocialAccountsProjectPrompt({
  kind = "accounts",
  notice,
  autoOpen = true,
}: SocialAccountsProjectPromptProps) {
  const copy = NEED_PROJECT_COPY[kind];
  const t = useTranslations("App.Social");
  const router = useRouter();
  const { switchHref } = useProjectScope();

  return (
    <ProjectScopeRequired
      autoOpen={autoOpen}
      body={notice ?? t(`${copy}.body`)}
      onSelect={(nextProjectId) => {
        // Scope switching resets page filters. Keep the tab that asked for a project.
        router.push(`${switchHref(nextProjectId)}&tab=${kind}`);
      }}
      testId="social-no-project"
      title={t(`${copy}.title`)}
    >
      {kind === "accounts" ? (
        <SocialPlatformCarousel />
      ) : (
        <SocialPostFan kind={kind} />
      )}
    </ProjectScopeRequired>
  );
}

/** Two platforms fanned behind the tab's own mark: a post waiting on them. */
function SocialPostFan({ kind }: { kind: "attention" | "drafts" }) {
  const [left, right] = socialProvidersEnabledFirst(
    useSocialProviderAvailability().enabledProviders,
  );
  const Mark = kind === "drafts" ? PenLine : CircleAlert;
  const tile =
    "bg-card flex size-16 items-center justify-center rounded-2xl border";

  return (
    <div
      aria-hidden
      className="flex items-end justify-center"
      data-testid="social-post-fan"
    >
      {left ? (
        <span className={cn(tile, "-mr-3 -rotate-6")}>
          <left.Icon className="size-7" />
        </span>
      ) : null}
      <span
        className={cn(tile, "text-muted-foreground relative z-10 mb-3 size-20")}
      >
        <Mark className="size-8" />
      </span>
      {right ? (
        <span className={cn(tile, "-ml-3 rotate-6")}>
          <right.Icon className="size-7" />
        </span>
      ) : null}
    </div>
  );
}

function SocialPlatformCard({
  comingSoonLabel,
  personalProfileLabel,
  provider,
}: {
  comingSoonLabel: string;
  personalProfileLabel: string;
  provider: (typeof SOCIAL_PROVIDERS)[number];
}) {
  const { isProviderEnabled } = useSocialProviderAvailability();
  return (
    <div className="bg-card flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl border px-3 py-5">
      <provider.Icon className="size-8" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{provider.name}</p>
        {!isProviderEnabled(provider.id) ? (
          <Badge variant="secondary">{comingSoonLabel}</Badge>
        ) : provider.id === "linkedin" ? (
          <span className="text-muted-foreground block text-xs">
            {personalProfileLabel}
          </span>
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
  const personalProfileLabel = accounts("personalProfile");
  const providers = socialProvidersEnabledFirst(
    useSocialProviderAvailability().enabledProviders,
  );

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
              {providers.map((provider) => (
                <li
                  key={`${provider.id}-${copy}`}
                  className="w-[40cqw] shrink-0 pl-3 sm:w-[calc(100cqw/3)] lg:w-[calc(100cqw/6)]"
                >
                  <SocialPlatformCard
                    comingSoonLabel={comingSoonLabel}
                    personalProfileLabel={personalProfileLabel}
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
