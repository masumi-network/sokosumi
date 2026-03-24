"use client";

import { TaskEventOrigin } from "@sokosumi/database";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type MouseEvent, useState } from "react";

import { COWORKER_FALLBACK_IMAGES } from "@/app/tasks/utils/coworker-fallback-images";
import { canUseNextImageSrc } from "@/config/next-image";
import {
  ORIGIN_APP_NAME_KEY_MAP,
  ORIGIN_ICON_MAP,
} from "@/lib/constants/task-event-origin-icons";
import type { CoworkerChannel } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

import { AgentVerifiedBadge } from "./agent-verified-badge";
import {
  DEFAULT_COWORKER_DESCRIPTION,
  DEFAULT_COWORKER_SUBTITLE,
} from "./coworker-gallery-defaults";

interface CoworkerGalleryCardProps {
  slug: string;
  name: string;
  image?: string | null;
  caption?: string | null;
  description?: string | null;
  /** Contact channels from coworker metadata (email, WhatsApp, etc.). */
  channels?: CoworkerChannel[];
  className?: string;
  action?: React.ReactNode;
}

function CoworkerGalleryCard({
  slug,
  name,
  image,
  caption,
  description,
  channels = [],
  className,
  action,
}: CoworkerGalleryCardProps) {
  const t = useTranslations("App.Tasks.Detail");
  const [expandedOrigin, setExpandedOrigin] = useState<TaskEventOrigin | null>(
    null,
  );

  function handleChannelButtonClick(
    event: MouseEvent<HTMLButtonElement>,
    origin: TaskEventOrigin,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setExpandedOrigin((previous) => (previous === origin ? null : origin));
  }

  const imageSrc =
    image ||
    COWORKER_FALLBACK_IMAGES[slug] ||
    "/images/logos/sokosumi-logo-white.svg";
  const canUseNextImage = canUseNextImageSrc(imageSrc);
  const displayDescription = description || DEFAULT_COWORKER_DESCRIPTION;
  const coworkerNewTaskHref = `/tasks?create=true&coworker=${encodeURIComponent(slug)}`;
  const cardClassName = cn(
    "group block w-full rounded-lg focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 focus-visible:outline-none md:w-80",
    !action && "cursor-pointer",
    className,
  );

  const channelBlock =
    channels.length > 0 ? (
      <div
        className="mt-2 space-y-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap gap-1.5">
          {channels.map(({ origin, value }) => {
            const OriginIcon = ORIGIN_ICON_MAP[origin];
            const label = t(`originApp.${ORIGIN_APP_NAME_KEY_MAP[origin]}`);
            const isExpanded = expandedOrigin === origin;
            return (
              <button
                key={`${origin}-${value.slice(0, 12)}`}
                type="button"
                onClick={(event) => handleChannelButtonClick(event, origin)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-white/55 transition-colors hover:text-white",
                  isExpanded && "border-white/30 bg-white/15 text-white",
                )}
                aria-label={label}
                aria-pressed={isExpanded}
              >
                <OriginIcon className="size-3.5 shrink-0" aria-hidden />
              </button>
            );
          })}
        </div>
        {expandedOrigin ? (
          <p className="text-xs break-all text-white/90">
            {channels.find((c) => c.origin === expandedOrigin)?.value}
          </p>
        ) : null}
      </div>
    ) : null;

  const imageClassName =
    "object-cover object-top transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.03]";

  const cardContent = (
    <div className="relative aspect-3/4 w-full overflow-hidden rounded-lg">
      {canUseNextImage ? (
        <Image
          src={imageSrc}
          alt={name}
          fill
          className={imageClassName}
          sizes="(max-width: 768px) 100vw, 320px"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- next/image rejects unconfigured remote hosts
        <img
          src={imageSrc}
          alt={name}
          className={cn("absolute inset-0 size-full", imageClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}

      {/* Verified badge */}
      <div className="absolute top-3 right-3">
        <AgentVerifiedBadge className="bg-black/70 [&>svg]:text-white/90" />
      </div>

      {/* Text overlay with scrim */}
      <div className="absolute inset-x-0 bottom-0 bg-black/70 p-3">
        <p className="text-xs font-medium text-white/70">
          {caption ?? DEFAULT_COWORKER_SUBTITLE}
        </p>
        <h3 className="truncate text-base font-medium text-balance text-white">
          {name}
        </h3>
        <p className="mt-1 line-clamp-2 max-h-10 min-h-10 overflow-hidden text-sm leading-5 text-pretty text-white/70 transition-[max-height] duration-300 ease-out group-focus-within:line-clamp-5 group-focus-within:max-h-25 group-hover:line-clamp-5 group-hover:max-h-25">
          {displayDescription}
        </p>
        {channelBlock}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );

  if (action) return <div className={cardClassName}>{cardContent}</div>;

  return (
    <Link href={coworkerNewTaskHref} className={cardClassName}>
      {cardContent}
    </Link>
  );
}

export { CoworkerGalleryCard };
