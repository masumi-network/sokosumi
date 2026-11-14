"use client";

import { ProjectHealth, type ProjectHealthState } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { Textarea } from "@/components/ui/textarea";
import { setProjectHealth } from "@/lib/actions/project/action";
import { cn } from "@/lib/utils";

/** Matches Core's health note limit. */
const NOTE_MAX_LENGTH = 280;

const HEALTH_OPTIONS = [
  ProjectHealth.ON_TRACK,
  ProjectHealth.AT_RISK,
  ProjectHealth.OFF_TRACK,
] as const;

/** On track reads as done, At risk as waiting on someone, Off track as a fault. */
const HEALTH_MARKERS: Record<ProjectHealth, StatusMarkerSpec> = {
  [ProjectHealth.ON_TRACK]: {
    tone: { hue: "resolved", weight: "filled" },
    icon: MARKER_ICONS.completed,
  },
  [ProjectHealth.AT_RISK]: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.warning,
  },
  [ProjectHealth.OFF_TRACK]: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.failed,
  },
};

export function ProjectHealthBadge({
  status,
  className,
}: {
  status: ProjectHealth;
  className?: string;
}) {
  const t = useTranslations("App.Projects.Health");
  const marker = HEALTH_MARKERS[status];
  const style = getToneStyle(marker.tone);

  return (
    <Badge
      variant="default"
      data-testid="project-health-badge"
      // Restated so the marker keeps its 14px glyph inside a Badge; see
      // TaskFileStatusBadge.
      className={cn(
        style.box,
        style.label,
        "gap-1.5 [&>svg]:size-3.5",
        className,
      )}
    >
      <StatusMarker spec={marker} />
      {t(`status.${status}`)}
    </Badge>
  );
}

interface ProjectHealthSectionProps {
  projectId: string;
  health: ProjectHealthState | null;
  /** CMO, closing and closed Projects show their health but cannot change it. */
  readOnly?: boolean;
}

/**
 * The team's own verdict on the Project, set by hand. The Latest update below
 * it is the generated summary; this says whether people think it is on track,
 * who said so, and when, so a verdict nobody refreshed reads as old.
 */
export function ProjectHealthSection({
  projectId,
  health: initialHealth,
  readOnly = false,
}: ProjectHealthSectionProps) {
  const t = useTranslations("App.Projects.Health");
  const [health, setHealth] = useState(initialHealth);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ProjectHealth | "">(
    initialHealth?.status ?? "",
  );
  const [note, setNote] = useState(initialHealth?.note ?? "");
  const [saving, setSaving] = useState<"save" | "clear" | null>(null);

  function handleOpenChange(next: boolean): void {
    if (next) {
      setStatus(health?.status ?? "");
      setNote(health?.note ?? "");
    }
    setOpen(next);
  }

  async function save(nextStatus: ProjectHealth | null): Promise<void> {
    setSaving(nextStatus ? "save" : "clear");
    try {
      const result = await setProjectHealth({
        projectId,
        status: nextStatus,
        note,
      });
      if (!result.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      setHealth(result.value.health);
      setOpen(false);
      toast.success(nextStatus ? t("saved") : t("cleared"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      aria-labelledby="project-health-title"
      className="space-y-2"
      data-testid="project-health"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="project-health-title"
          className="text-muted-foreground text-xs font-medium"
        >
          {t("title")}
        </h2>
        {readOnly ? null : (
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                {health ? t("change") : t("set")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <RadioGroup
                aria-label={t("title")}
                value={status}
                onValueChange={(value) => setStatus(value as ProjectHealth)}
                className="gap-2"
              >
                {HEALTH_OPTIONS.map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem
                      value={option}
                      id={`project-health-${option}`}
                    />
                    <Label htmlFor={`project-health-${option}`}>
                      <ProjectHealthBadge status={option} />
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <div className="space-y-1">
                <Label htmlFor="project-health-note">{t("noteLabel")}</Label>
                <Textarea
                  id="project-health-note"
                  maxLength={NOTE_MAX_LENGTH}
                  placeholder={t("notePlaceholder")}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                {health ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving !== null}
                    loading={saving === "clear"}
                    onClick={() => void save(null)}
                  >
                    {t("clear")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={!status || saving !== null}
                  loading={saving === "save"}
                  onClick={() => status && void save(status)}
                >
                  {t("save")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {health ? (
        <div className="space-y-1">
          <ProjectHealthBadge status={health.status} />
          {health.note ? (
            <p className="text-sm wrap-anywhere">{health.note}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {health.setByName
              ? t("setBy", { name: health.setByName })
              : t("setByUnknown")}{" "}
            <TimeAgo date={health.setAt} />
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      )}
    </section>
  );
}
