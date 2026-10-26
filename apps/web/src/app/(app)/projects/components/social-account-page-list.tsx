"use client";

import type {
  ProjectSocialConnection,
  ProjectSocialConnectionPage,
} from "@sokosumi/core-client";
import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountChipMark } from "@/components/social-account-chip-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** What the picker shows; `available` with no pages is the empty state. */
export type SocialAccountPageListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "permission_missing" }
  | { kind: "available"; pages: ProjectSocialConnectionPage[] };

interface SocialAccountPageListProps {
  /** The personal account the pages are administered through. */
  connection: ProjectSocialConnection;
  state: SocialAccountPageListState;
  /** Page ids being added right now. */
  addingIds?: ReadonlySet<string>;
  onAdd?: (page: ProjectSocialConnectionPage) => void;
  onRetry?: () => void;
}

/**
 * "Post as" choices: the personal profile plus every page it administers.
 * The Core pages endpoint is provider-neutral, so a Facebook Page picker can
 * reuse this list.
 */
export function SocialAccountPageList({
  connection,
  state,
  addingIds,
  onAdd,
  onRetry,
}: SocialAccountPageListProps) {
  const t = useTranslations("App.Projects.ProjectSocialAccounts.linkedInPages");
  const personalName =
    connection.displayName?.trim() || connection.externalHandle || t("you");

  return (
    <div className="space-y-3" data-testid="social-account-page-list">
      <ul className="divide-y rounded-lg border" aria-label={t("listLabel")}>
        <li className="flex items-center gap-3 p-3">
          <AccountChipMark
            avatarUrl={connection.avatarUrl}
            provider={connection.provider}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{personalName}</p>
            <p className="text-muted-foreground text-xs">{t("personal")}</p>
          </div>
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Check className="size-3.5" aria-hidden />
            {t("added")}
          </span>
        </li>
        {state.kind === "loading"
          ? [0, 1].map((index) => (
              <li
                key={index}
                className="flex items-center gap-3 p-3"
                aria-hidden
                data-testid="social-account-page-skeleton"
              >
                <Skeleton className="size-6 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </li>
            ))
          : null}
        {state.kind === "available"
          ? state.pages.map((page) => {
              const name = page.name?.trim() || page.handle || t("unnamed");
              const added = page.socialConnectionId !== null;
              return (
                <li
                  key={page.externalAccountId}
                  className="flex items-center gap-3 p-3"
                  data-testid={`social-account-page-${page.externalAccountId}`}
                >
                  <AccountChipMark
                    avatarUrl={page.logoUrl}
                    provider={connection.provider}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                      <Badge variant="secondary">{t("companyPage")}</Badge>
                      {page.handle ? <span>{page.handle}</span> : null}
                    </p>
                  </div>
                  {added ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                      <Check className="size-3.5" aria-hidden />
                      {t("added")}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 md:h-8"
                      aria-label={t("addPage", { page: name })}
                      disabled={!onAdd}
                      loading={addingIds?.has(page.externalAccountId)}
                      onClick={() => onAdd?.(page)}
                    >
                      <Plus className="size-4" aria-hidden />
                      {t("add")}
                    </Button>
                  )}
                </li>
              );
            })
          : null}
      </ul>
      {state.kind === "loading" ? (
        <p className="sr-only" role="status">
          {t("loading")}
        </p>
      ) : null}
      {state.kind === "available" && state.pages.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("empty")}
        </p>
      ) : null}
      {state.kind === "permission_missing" ? (
        <p
          className="text-muted-foreground text-sm"
          role="status"
          data-testid="social-account-page-permission-missing"
        >
          {t("permissionMissing")}
        </p>
      ) : null}
      {state.kind === "error" ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-destructive text-sm">{t("error")}</p>
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={onRetry}
            >
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
