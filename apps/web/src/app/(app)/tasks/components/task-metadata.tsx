import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ipfsUrlResolver } from "@/lib/ipfs";
import { formatShortDate } from "@/lib/utils/datetime";
import { TaskWithCoworker } from "@/lib/types/task";

import { TaskStatusBadge } from "./task-status-badge";

const COWORKER_FALLBACK_IMAGES: Record<string, string> = {
  soko: "/images/kanji/sokosumi-logo-kanji-black.svg",
  sumi: "/images/kanji/sokosumi-logo-kanji-black.svg",
  hannah: "/images/coworkers/hannah.png",
};

function getCoworkerImage(coworker: TaskWithCoworker["coworker"]): string | null {
  if (coworker?.image) {
    return ipfsUrlResolver(coworker.image);
  }
  const slug = coworker?.slug?.toLowerCase() ?? coworker?.name?.toLowerCase();
  if (slug && COWORKER_FALLBACK_IMAGES[slug]) {
    return COWORKER_FALLBACK_IMAGES[slug];
  }
  return null;
}

interface TaskMetadataLabels {
  status: string;
  coworker: string;
}

interface TaskMetadataProps {
  task: TaskWithCoworker;
  labels: TaskMetadataLabels;
}

export function TaskMetadata({ task, labels }: TaskMetadataProps) {
  const coworkerImage = getCoworkerImage(task.coworker);

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Properties</h3>

      <div className="space-y-3">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{labels.status}</span>
          <TaskStatusBadge status={task.status} showLabel />
        </div>

        {/* Coworker */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{labels.coworker}</span>
          <div className="flex items-center gap-2">
            <Avatar className="size-5">
              {coworkerImage ? (
                <AvatarImage
                  src={coworkerImage}
                  alt={task.coworker?.name ?? "Coworker"}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="text-[10px] bg-muted">
                {task.coworker?.name?.slice(0, 1).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">
              {task.coworker?.name ?? "—"}
            </span>
          </div>
        </div>

        <div className="border-t border-border/50 my-3" />

        {/* Created */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Created</span>
          <span className="text-sm tabular-nums text-muted-foreground">{formatShortDate(task.createdAt)}</span>
        </div>

        {/* Updated */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Updated</span>
          <span className="text-sm tabular-nums text-muted-foreground">{formatShortDate(task.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}
