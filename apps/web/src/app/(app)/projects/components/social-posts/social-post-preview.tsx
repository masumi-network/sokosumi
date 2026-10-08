"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import {
  BarChart2,
  Bookmark,
  Globe,
  Heart,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Repeat2,
  Send,
  Share,
  ThumbsUp,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { cn } from "@/lib/utils";
import {
  accountHandle,
  accountName,
  PreviewAvatar,
  PreviewMediaGrid,
  PreviewMediaItem,
  PreviewRichText,
  type SocialPostPreviewContentProps,
} from "./social-post-preview-parts";

interface SocialPostPreviewProps extends SocialPostPreviewContentProps {
  provider: SocialPost["provider"];
  className?: string;
}

/**
 * How a post will look in the network's own feed. X, LinkedIn and Instagram
 * render their native layout; the other networks share a neutral card.
 * Engagement rows are decorative: nothing here reads live feed data.
 */
export function SocialPostPreview({
  provider,
  className,
  ...content
}: SocialPostPreviewProps) {
  const t = useTranslations("App.Projects.SocialPosts.preview");
  return (
    <figure
      aria-label={t("label", { provider: socialPostProviderLabel(provider) })}
      className={cn(
        "bg-background text-foreground overflow-hidden rounded-xl border text-sm",
        className,
      )}
      data-provider={provider}
      data-testid="social-post-preview"
    >
      {provider === "x" ? (
        <XPreview {...content} />
      ) : provider === "linkedin" ? (
        <LinkedInPreview {...content} />
      ) : provider === "instagram" ? (
        <InstagramPreview {...content} />
      ) : (
        <GenericPreview provider={provider} {...content} />
      )}
    </figure>
  );
}

function usePreviewTime(timestamp: Date | null, timestampLabel?: string) {
  const t = useTranslations("App.Projects.SocialPosts.preview");
  const formatter = useFormatter();
  return (
    timestampLabel ??
    (timestamp
      ? formatter.dateTime(timestamp, { month: "short", day: "numeric" })
      : t("now"))
  );
}

/**
 * Long text folds behind the network's own inline "more" link: the first
 * lines, cut at a character budget, the way LinkedIn and Instagram show it.
 */
function useFold(text: string, maxChars: number, maxLines: number) {
  const [expanded, setExpanded] = useState(false);
  const head = text
    .split("\n")
    .slice(0, maxLines)
    .join("\n")
    .slice(0, maxChars);
  const folded = !expanded && head.length < text.length;
  return {
    folded,
    visibleText: folded ? head.trimEnd() : text,
    expand: () => setExpanded(true),
  };
}

function XPreview({
  account,
  media,
  text,
  timestamp,
  timestampLabel,
  showEngagementActions = true,
}: SocialPostPreviewContentProps) {
  const t = useTranslations("App.Projects.SocialPosts.preview");
  const name = accountName(account, t("accountFallback"));
  const handle = accountHandle(account);
  const time = usePreviewTime(timestamp, timestampLabel);
  const actions = [
    { Icon: MessageCircle, key: "reply" },
    { Icon: Repeat2, key: "repost" },
    { Icon: Heart, key: "like" },
    { Icon: BarChart2, key: "views" },
  ];

  return (
    <div
      className={cn(
        "flex gap-3 px-4 pt-3 pb-2",
        !showEngagementActions && "py-4",
      )}
    >
      <PreviewAvatar account={account} name={name} className="size-10" />
      <div className="min-w-0 flex-1">
        {showEngagementActions ? (
          <div className="flex items-center gap-1 leading-5">
            <span className="truncate font-bold">{name}</span>
            <span className="text-muted-foreground truncate">
              {handle ? `${handle} · ${time}` : time}
            </span>
            <MoreHorizontal
              className="text-muted-foreground ms-auto size-4 shrink-0"
              aria-hidden
            />
          </div>
        ) : (
          <div className="space-y-0.5 leading-5">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-semibold">{name}</span>
              <SocialPostProviderIcon
                provider="x"
                className="size-4 shrink-0"
                aria-hidden
              />
            </div>
            {handle ? (
              <p className="text-muted-foreground break-words text-xs">
                {handle}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">{time}</p>
          </div>
        )}
        {text ? (
          <p
            className={cn(
              "leading-5 whitespace-pre-wrap break-words",
              showEngagementActions ? "mt-0.5" : "mt-3",
            )}
          >
            <PreviewRichText text={text} linkClassName="text-social-x-link" />
          </p>
        ) : null}
        <PreviewMediaGrid media={media} className="mt-3 rounded-2xl border" />
        {showEngagementActions ? (
          <div
            aria-hidden
            className="text-muted-foreground mt-3 flex items-center justify-between pe-8"
          >
            {actions.map(({ Icon, key }) => (
              <Icon key={key} className="size-4" />
            ))}
            <span className="flex gap-3">
              <Bookmark className="size-4" />
              <Share className="size-4" />
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LinkedInPreview({
  account,
  media,
  text,
  timestamp,
  timestampLabel,
  showEngagementActions = true,
}: SocialPostPreviewContentProps) {
  const t = useTranslations("App.Projects.SocialPosts.preview");
  const name = accountName(account, t("accountFallback"));
  const time = usePreviewTime(timestamp, timestampLabel);
  const fold = useFold(text, 210, 3);
  const actions = [
    { Icon: ThumbsUp, label: t("linkedin.like") },
    { Icon: MessageSquare, label: t("linkedin.comment") },
    { Icon: Repeat2, label: t("linkedin.repost") },
    { Icon: Send, label: t("linkedin.send") },
  ];

  return (
    <div>
      <div className="flex gap-2 px-4 pt-3">
        <PreviewAvatar account={account} name={name} className="size-12" />
        <div className="min-w-0 flex-1 leading-4">
          <p
            className={
              showEngagementActions
                ? "truncate font-semibold"
                : "break-words font-semibold"
            }
          >
            {name}
          </p>
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            {time} ·
            <Globe className="size-3" aria-label={t("linkedin.public")} />
          </p>
        </div>
        {showEngagementActions ? (
          <MoreHorizontal
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden
          />
        ) : (
          <SocialPostProviderIcon
            provider="linkedin"
            className="size-5 shrink-0"
            aria-hidden
          />
        )}
      </div>
      {text ? (
        <div className="px-4 pt-3 pb-2">
          <p className="leading-5 whitespace-pre-wrap break-words">
            <PreviewRichText
              text={fold.visibleText}
              linkClassName="text-social-linkedin-link font-semibold"
            />
            {fold.folded ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-social-linkedin-link ms-1 hover:underline"
                onClick={fold.expand}
              >
                {t("linkedin.seeMore")}
              </button>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="h-3" />
      )}
      <PreviewMediaGrid media={media} />
      {showEngagementActions ? (
        <div
          aria-hidden
          className="text-muted-foreground mx-4 flex justify-between border-t py-1"
        >
          {actions.map(({ Icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 px-2 py-2 text-sm font-semibold"
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InstagramPreview({
  account,
  media,
  text,
  timestamp,
  timestampLabel,
  showMediaPlaceholder = true,
  showEngagementActions = true,
}: SocialPostPreviewContentProps) {
  const t = useTranslations("App.Projects.SocialPosts.preview");
  const formatter = useFormatter();
  const name =
    account?.handle?.replace(/^@/, "") ??
    accountName(account, t("accountFallback"));
  const fold = useFold(text, 125, 2);
  const [first] = media;

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <PreviewAvatar account={account} name={name} className="size-8" />
        <span
          className={cn(
            "min-w-0 flex-1 font-semibold",
            showEngagementActions ? "truncate" : "break-words",
          )}
        >
          {name}
        </span>
        {showEngagementActions ? (
          <MoreHorizontal className="size-5 shrink-0" aria-hidden />
        ) : (
          <SocialPostProviderIcon
            provider="instagram"
            className="size-5 shrink-0"
            aria-hidden
          />
        )}
      </div>
      {first || showMediaPlaceholder ? (
        <div className="bg-muted aspect-square overflow-hidden">
          {first ? (
            <PreviewMediaItem media={first} />
          ) : (
            <div className="text-muted-foreground flex size-full items-center justify-center px-6 text-center text-xs text-balance">
              {t("instagram.mediaRequired")}
            </div>
          )}
        </div>
      ) : null}
      {showEngagementActions ? (
        <div aria-hidden className="flex items-center gap-4 px-3 pt-3">
          <Heart className="size-6" />
          <MessageCircle className="size-6 -scale-x-100" />
          <Send className="size-6" />
          <Bookmark className="ms-auto size-6" />
        </div>
      ) : null}
      <div className="space-y-1 px-3 pt-2 pb-3">
        {text ? (
          <p className="leading-5 whitespace-pre-wrap break-words">
            <span className="me-1 font-semibold">{name}</span>
            <PreviewRichText
              text={fold.visibleText}
              linkClassName="text-social-instagram-link"
            />
            {fold.folded ? (
              <>
                …{" "}
                <button
                  type="button"
                  className="text-muted-foreground"
                  onClick={fold.expand}
                >
                  {t("instagram.more")}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {timestampLabel ??
            (timestamp
              ? formatter.dateTime(timestamp, { month: "long", day: "numeric" })
              : t("now"))}
        </p>
      </div>
    </div>
  );
}

function GenericPreview({
  provider,
  account,
  media,
  text,
  timestamp,
  timestampLabel,
  showEngagementActions = true,
}: SocialPostPreviewContentProps & { provider: SocialPost["provider"] }) {
  const t = useTranslations("App.Projects.SocialPosts.preview");
  const name = accountName(account, t("accountFallback"));
  const time = usePreviewTime(timestamp, timestampLabel);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <PreviewAvatar account={account} name={name} className="size-10" />
        <div className="min-w-0 flex-1 leading-5">
          <p
            className={
              showEngagementActions
                ? "truncate font-semibold"
                : "break-words font-semibold"
            }
          >
            {name}
          </p>
          <p className="text-muted-foreground text-xs">{time}</p>
        </div>
        <SocialPostProviderIcon provider={provider} className="size-5" />
      </div>
      {text ? (
        <p className="leading-5 whitespace-pre-wrap break-words">{text}</p>
      ) : null}
      <PreviewMediaGrid media={media} className="rounded-lg" />
    </div>
  );
}
