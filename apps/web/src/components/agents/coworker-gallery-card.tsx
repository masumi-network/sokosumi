import Image from "next/image";
import Link from "next/link";

import { COWORKER_FALLBACK_IMAGES } from "@/app/tasks/utils/coworker-fallback-images";
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
  className?: string;
  action?: React.ReactNode;
}

function CoworkerGalleryCard({
  slug,
  name,
  image,
  caption,
  description,
  className,
  action,
}: CoworkerGalleryCardProps) {
  const imageSrc =
    image ||
    COWORKER_FALLBACK_IMAGES[slug] ||
    "/images/logos/sokosumi-logo-white.svg";
  const displayDescription = description || DEFAULT_COWORKER_DESCRIPTION;
  const coworkerChatHref = `/chat?coworker=${encodeURIComponent(slug)}`;
  const cardClassName = cn(
    "group block w-full rounded-lg focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 focus-visible:outline-none md:w-80",
    !action && "cursor-pointer",
    className,
  );
  const cardContent = (
    <div className="relative aspect-3/4 w-full overflow-hidden rounded-lg">
      <Image
        src={imageSrc}
        alt={name}
        fill
        className="object-cover object-top transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.03]"
        sizes="(max-width: 768px) 100vw, 320px"
      />

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
        <p className="mt-1 line-clamp-2 max-h-10 min-h-10 overflow-hidden text-sm leading-5 text-pretty text-white/70 transition-[max-height] duration-300 ease-out group-focus-within:max-h-25 group-hover:max-h-25 hover:line-clamp-5">
          {displayDescription}
        </p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );

  if (action) return <div className={cardClassName}>{cardContent}</div>;

  return (
    <Link href={coworkerChatHref} className={cardClassName}>
      {cardContent}
    </Link>
  );
}

export { CoworkerGalleryCard };
