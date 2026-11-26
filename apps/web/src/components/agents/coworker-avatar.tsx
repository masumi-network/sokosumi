import type { Coworker } from "@sokosumi/core-client";
import Image from "next/image";

import { COWORKER_FALLBACK_IMAGES } from "@/app/tasks/utils/coworker-fallback-images";
import { canUseNextImageSrc } from "@/config/next-image";
import { cn } from "@/lib/utils";

function coworkerImage(coworker: Pick<Coworker, "image" | "slug">): string {
  return (
    coworker.image ||
    COWORKER_FALLBACK_IMAGES[coworker.slug] ||
    "/images/logos/sokosumi-logo-white.svg"
  );
}

/** A coworker's round face; the caller sets the size through `className`. */
export function CoworkerAvatar({
  coworker,
  className,
  sizes = "96px",
}: {
  coworker: Pick<Coworker, "image" | "slug" | "name">;
  className?: string;
  sizes?: string;
}) {
  const image = coworkerImage(coworker);
  return (
    <span
      className={cn(
        "bg-muted ring-border relative block shrink-0 overflow-hidden rounded-full ring-1",
        className,
      )}
    >
      {canUseNextImageSrc(image) ? (
        <Image src={image} alt="" fill className="object-cover" sizes={sizes} />
      ) : (
        // next/image rejects unconfigured remote hosts.
        <img
          src={image}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
    </span>
  );
}
