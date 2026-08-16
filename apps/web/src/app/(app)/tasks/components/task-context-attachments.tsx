"use client";

import { Check, ChevronDown, FileText, Globe, Info } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  type DesignMdAdHocAttachment,
  DesignMdAdHocDialog,
} from "@/components/design-md";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Favicon } from "@/components/ui/favicon";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import { cn } from "@/lib/utils";
import { buildFaviconCandidates } from "@/lib/utils/url";

export interface TaskContextAttachmentsSelection {
  brand: {
    enabled: boolean;
    source: "project" | "default" | "custom";
    custom?: DesignMdAdHocAttachment | null;
  };
  briefingEnabled: boolean;
  contextMdEnabled: boolean;
}

interface TaskContextAttachmentsFieldProps {
  defaultBrand: EffectiveDesignMdAttachment | null;
  project?: ProjectFilterOption;
  selection: TaskContextAttachmentsSelection;
  onSelectionChange: (next: TaskContextAttachmentsSelection) => void;
  className?: string;
}

interface TogglePillProps {
  label: React.ReactNode;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function TogglePill({ label, pressed, onPressedChange }: TogglePillProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "focus-visible:ring-ring inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2",
        pressed
          ? "bg-secondary text-secondary-foreground border-transparent"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
      onClick={() => onPressedChange(!pressed)}
    >
      {label}
    </button>
  );
}

function DefaultBrandAvatar({
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

export function getDefaultTaskContextSelection(
  project?: ProjectFilterOption,
): TaskContextAttachmentsSelection {
  return {
    brand: {
      enabled: true,
      source: project?.designMd ? "project" : "default",
      custom: null,
    },
    briefingEnabled: true,
    contextMdEnabled: true,
  };
}

export function TaskContextAttachmentsField({
  defaultBrand,
  project,
  selection,
  onSelectionChange,
  className,
}: TaskContextAttachmentsFieldProps) {
  const t = useTranslations("App.Tasks.NewTask.ContextAttachments");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [isAdHocDialogOpen, setIsAdHocDialogOpen] = useState(false);

  const contextUpdatedAt = project?.contextMd?.updatedAt
    ? new Date(project.contextMd.updatedAt)
    : null;
  const contextUpdatedLabel =
    contextUpdatedAt && !Number.isNaN(contextUpdatedAt.getTime())
      ? formatter.relativeTime(contextUpdatedAt, { now, style: "narrow" })
      : null;

  let brandLabel = t("brand");
  let brandAvatar: React.ReactNode = (
    <DefaultBrandAvatar brand={defaultBrand} />
  );

  if (selection.brand.source === "custom" && selection.brand.custom) {
    brandLabel = getHostname(selection.brand.custom.sourceUrl);
    brandAvatar = (
      <span className="bg-muted flex size-4 items-center justify-center overflow-hidden rounded-full">
        <Favicon
          sources={buildFaviconCandidates(selection.brand.custom.sourceUrl)}
          alt=""
          size={14}
          className="rounded-full"
          fallback={
            <Globe className="text-muted-foreground size-2.5" aria-hidden />
          }
        />
      </span>
    );
  } else if (selection.brand.source === "project" && project?.designMd) {
    brandLabel = t("namedBrand", { name: project.name });
    brandAvatar = (
      <ProjectAvatar
        name={project.name}
        logo={project.logo}
        className="size-4 rounded-full"
      />
    );
  } else if (defaultBrand?.owner.type === "organization") {
    brandLabel = t("namedBrand", { name: defaultBrand.owner.name });
  } else if (defaultBrand) {
    brandLabel = t("personalBrand");
  }

  // Nothing to attach until a brand exists somewhere: no project DESIGN.md,
  // no effective org/personal one, no ad hoc pick. The pill then reads as an
  // unselected "Brand" and its body opens the "other website" flow directly.
  const brandAvailable =
    (selection.brand.source === "custom" && selection.brand.custom !== null) ||
    (selection.brand.source === "project" && Boolean(project?.designMd)) ||
    (selection.brand.source === "default" && defaultBrand !== null);
  const brandPressed = selection.brand.enabled && brandAvailable;

  function selectBrandSource(source: "project" | "default") {
    onSelectionChange({
      ...selection,
      brand: { enabled: true, source, custom: null },
    });
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2",
        className,
      )}
    >
      <span className="text-muted-foreground mr-1 text-xs font-medium">
        {t("label")}
      </span>

      <div
        className={cn(
          "inline-flex h-7 items-center overflow-hidden rounded-full border text-xs font-medium transition-colors",
          brandPressed
            ? "bg-secondary text-secondary-foreground border-transparent"
            : "text-muted-foreground",
        )}
      >
        <button
          type="button"
          aria-pressed={brandPressed}
          aria-label={brandLabel}
          className="focus-visible:ring-ring inline-flex h-full min-w-0 items-center gap-1.5 py-0 pr-1.5 pl-2 outline-none focus-visible:ring-2"
          onClick={() => {
            if (!brandAvailable) {
              setIsAdHocDialogOpen(true);
              return;
            }
            onSelectionChange({
              ...selection,
              brand: {
                ...selection.brand,
                enabled: !selection.brand.enabled,
              },
            });
          }}
        >
          {brandAvatar}
          <span className="max-w-36 truncate">{brandLabel}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("brandMenuAria")}
              className="focus-visible:ring-ring hover:bg-accent/70 inline-flex h-full items-center border-l border-current/10 px-1.5 outline-none focus-visible:ring-2"
            >
              <ChevronDown className="size-3" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {project?.designMd ? (
              <DropdownMenuItem
                aria-label={t("projectBrand")}
                onSelect={() => selectBrandSource("project")}
              >
                <ProjectAvatar
                  name={project.name}
                  logo={project.logo}
                  className="size-4 rounded-full"
                />
                <span className="flex-1">{t("projectBrand")}</span>
                {selection.brand.source === "project" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : null}
              </DropdownMenuItem>
            ) : null}
            {defaultBrand ? (
              <DropdownMenuItem
                aria-label={
                  defaultBrand.owner.type === "organization"
                    ? t("organizationBrand")
                    : t("personalBrand")
                }
                onSelect={() => selectBrandSource("default")}
              >
                <DefaultBrandAvatar brand={defaultBrand} />
                <span className="flex-1">
                  {defaultBrand.owner.type === "organization"
                    ? t("organizationBrand")
                    : t("personalBrand")}
                </span>
                {selection.brand.source === "default" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : null}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => setIsAdHocDialogOpen(true)}>
              <Globe className="size-4" aria-hidden />
              {t("otherWebsite")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {project?.briefingUrl ? (
        <TogglePill
          pressed={selection.briefingEnabled}
          onPressedChange={(briefingEnabled) =>
            onSelectionChange({ ...selection, briefingEnabled })
          }
          label={t("briefing")}
        />
      ) : null}

      {project?.contextMd ? (
        <TogglePill
          pressed={selection.contextMdEnabled}
          onPressedChange={(contextMdEnabled) =>
            onSelectionChange({ ...selection, contextMdEnabled })
          }
          label={
            <>
              {t("memory")}
              {contextUpdatedLabel ? (
                <span className="font-normal opacity-60">
                  · {contextUpdatedLabel}
                </span>
              ) : null}
            </>
          }
        />
      ) : null}

      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={t("infoAria")}
            className="text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="w-72 text-sm">
          <p className="text-muted-foreground">{t("info")}</p>
        </HoverCardContent>
      </HoverCard>

      <DesignMdAdHocDialog
        open={isAdHocDialogOpen}
        onOpenChange={setIsAdHocDialogOpen}
        onGenerated={(custom) => {
          onSelectionChange({
            ...selection,
            brand: { enabled: true, source: "custom", custom },
          });
          setIsAdHocDialogOpen(false);
        }}
      />
    </div>
  );
}
