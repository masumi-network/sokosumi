"use client";

import { TaskEventOrigin } from "@sokosumi/utils";
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

function normalizeWhatsAppPhone(value: string): string {
  return value.replace(/\D/g, "");
}

function getChannelHref(channel: CoworkerChannel): string | null {
  if (channel.origin === TaskEventOrigin.EMAIL) {
    const address = channel.value.trim();
    return address ? `mailto:${address}` : null;
  }

  if (channel.origin === TaskEventOrigin.WHATSAPP) {
    const normalizedPhone = normalizeWhatsAppPhone(channel.value);
    return normalizedPhone ? `https://wa.me/${normalizedPhone}` : null;
  }

  return null;
}

function handleChannelExternalLinkClick(
  event: MouseEvent<HTMLButtonElement>,
  href: string,
) {
  event.preventDefault();
  event.stopPropagation();
  if (href.startsWith("mailto:")) {
    window.location.assign(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
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
  const galleryCardT = useTranslations("App.Agents.CoworkerGalleryCard");
  const taskDetailT = useTranslations("App.Tasks.Detail");
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
  const displayDescription = description || galleryCardT("defaultDescription");
  const coworkerNewTaskHref = `/tasks?create=true&coworker=${encodeURIComponent(slug)}`;
  /** Nested <a> inside Next.js <Link> is invalid HTML; use buttons when the card is link-wrapped. */
  const useAnchorForExternalChannels = Boolean(action);
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
            const label = taskDetailT(
              `originApp.${ORIGIN_APP_NAME_KEY_MAP[origin]}`,
            );
            const isExpanded = expandedOrigin === origin;
            const href = getChannelHref({ origin, value });
            const sharedClasses = cn(
              "cursor-pointer inline-flex size-7 items-center justify-center rounded-md border border-transparent text-white/55 transition-colors hover:text-white",
              isExpanded && "border-white/30 bg-white/15 text-white",
            );

            if (href && useAnchorForExternalChannels) {
              return (
                <a
                  key={`${origin}-${value.slice(0, 12)}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={sharedClasses}
                  aria-label={label}
                >
                  <OriginIcon className="size-4 shrink-0" aria-hidden />
                </a>
              );
            }

            if (href) {
              return (
                <button
                  key={`${origin}-${value.slice(0, 12)}`}
                  type="button"
                  onClick={(event) =>
                    handleChannelExternalLinkClick(event, href)
                  }
                  className={sharedClasses}
                  aria-label={label}
                >
                  <OriginIcon className="size-4 shrink-0" aria-hidden />
                </button>
              );
            }

            return (
              <button
                key={`${origin}-${value.slice(0, 12)}`}
                type="button"
                onClick={(event) => handleChannelButtonClick(event, origin)}
                className={sharedClasses}
                aria-label={label}
                aria-pressed={isExpanded}
              >
                <OriginIcon className="size-4 shrink-0" aria-hidden />
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
          {caption ?? galleryCardT("defaultSubtitle")}
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
