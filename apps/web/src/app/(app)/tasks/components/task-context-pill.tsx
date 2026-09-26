import { Check, FileText, Globe } from "lucide-react";
import type { ReactNode } from "react";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Favicon } from "@/components/ui/favicon";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import { cn } from "@/lib/utils";
import { buildFaviconCandidates } from "@/lib/utils/url";

/** Explicit on/off readout: check when on, empty ring when off. */
export function PillMarker({ pressed }: { pressed: boolean }) {
  return pressed ? (
    <Check className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
  ) : (
    <span
      className="border-input size-3 shrink-0 rounded-full border"
      aria-hidden
    />
  );
}

export function StaticContextPill({
  label,
  leading,
  className,
}: {
  label: ReactNode;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        "bg-secondary text-secondary-foreground border-transparent",
        className,
      )}
    >
      <PillMarker pressed />
      {leading}
      <span className="max-w-36 truncate">{label}</span>
    </span>
  );
}

export function DefaultBrandAvatar({
  brand,
}: {
  brand: EffectiveDesignMdAttachment | null;
}) {
  if (brand?.owner.type === "organization") {
    return (
      <Avatar className="size-4">
        {brand.owner.logo ? (
          <AvatarImage src={brand.owner.logo} alt="" />
        ) : null}
        <AvatarFallback className="text-[0.5rem] font-medium">
          {brand.owner.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span className="bg-muted flex size-4 items-center justify-center rounded-full">
      <FileText className="text-muted-foreground size-2.5" aria-hidden />
    </span>
  );
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface BrandPillLabels {
  brand: string;
  namedBrand: (values: { name: string }) => string;
  personalBrand: string;
}

export function resolveBrandPillDisplay({
  brandSource,
  brandUrl,
  project,
  defaultBrand,
  labels,
}: {
  brandSource: "project" | "default" | "custom";
  brandUrl: string | null;
  project?: {
    name: string;
    logo?: string | null;
    designMd?: { url: string } | null;
  } | null;
  defaultBrand: EffectiveDesignMdAttachment | null;
  labels: BrandPillLabels;
}): { label: string; avatar: ReactNode } {
  if (brandSource === "custom" && brandUrl) {
    return {
      label: getHostname(brandUrl),
      avatar: (
        <span className="bg-muted flex size-4 items-center justify-center overflow-hidden rounded-full">
          <Favicon
            sources={buildFaviconCandidates(brandUrl)}
            alt=""
            size={14}
            className="rounded-full"
            fallback={
              <Globe className="text-muted-foreground size-2.5" aria-hidden />
            }
          />
        </span>
      ),
    };
  }

  if (brandSource === "project" && project?.designMd) {
    return {
      label: labels.namedBrand({ name: project.name }),
      avatar: (
        <ProjectAvatar
          name={project.name}
          logo={project.logo}
          className="size-4 rounded-full"
        />
      ),
    };
  }

  if (defaultBrand?.owner.type === "organization") {
    return {
      label: labels.namedBrand({ name: defaultBrand.owner.name }),
      avatar: <DefaultBrandAvatar brand={defaultBrand} />,
    };
  }

  if (defaultBrand) {
    return {
      label: labels.personalBrand,
      avatar: <DefaultBrandAvatar brand={defaultBrand} />,
    };
  }

  return {
    label: labels.brand,
    avatar: <DefaultBrandAvatar brand={defaultBrand} />,
  };
}
