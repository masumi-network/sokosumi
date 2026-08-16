"use client";

import {
  Eye,
  ListTodo,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PROJECTS_LIST_ROW_LAYOUT_CLASS } from "@/app/projects/constants";
import { previewProjectBriefing } from "@/app/projects/project-briefing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteProject } from "@/lib/actions/project/action";
import type { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

interface ProjectListItemLabels {
  actions: {
    moreActions: string;
    viewDetails: string;
    edit: string;
    delete: string;
  };
  deleteDialog: {
    title: string;
    description: string;
    confirm: string;
    cancel: string;
    error: string;
  };
  counts: {
    tasks: string;
    jobs: string;
  };
}

interface ProjectListItemProps {
  project: ProjectListItemType;
  labels: ProjectListItemLabels;
  onDeleted: (projectId: string) => void;
}

export function ProjectListItem({
  project,
  labels,
  onDeleted,
}: ProjectListItemProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const briefing = previewProjectBriefing(project.briefing);

  function handleDeleteProject() {
    startDeleteTransition(async () => {
      try {
        await deleteProject({ projectId: project.id });
        onDeleted(project.id);
        setIsDeleteDialogOpen(false);
      } catch {
        toast.error(labels.deleteDialog.error);
      }
    });
  }

  return (
    <article
      className={cn(
        "-mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
        PROJECTS_LIST_ROW_LAYOUT_CLASS,
      )}
    >
      <Link
        href={`/tasks?projectId=${project.id}`}
        className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg px-2 py-3 transition-colors active:scale-[0.995] sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {project.name}
            </span>
            <p className="text-muted-foreground/70 line-clamp-1 text-xs break-all">
              {briefing}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <ProjectResourceCounts project={project} labels={labels.counts} />
        </div>
      </Link>

      <div className="shrink-0 pl-2">
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={labels.actions.moreActions}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/projects/${project.id}`}>
                  <Eye className="size-4" aria-hidden />
                  {labels.actions.viewDetails}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/projects/${project.id}/edit`}>
                  <Pencil className="size-4" aria-hidden />
                  {labels.actions.edit}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  setIsDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                {labels.actions.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{labels.deleteDialog.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {labels.deleteDialog.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>
                {labels.deleteDialog.cancel}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={isDeleting}
                onClick={(event) => {
                  event.preventDefault();
                  handleDeleteProject();
                }}
              >
                {labels.deleteDialog.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}

function ProjectResourceCounts({
  project,
  labels,
}: {
  project: ProjectListItemType;
  labels: ProjectListItemLabels["counts"];
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
      <ResourceCountPill
        icon={ListTodo}
        ariaLabel={labels.tasks}
        total={project.taskCount}
      />
      <ResourceCountPill
        icon={Sparkles}
        ariaLabel={labels.jobs}
        total={project.jobCount}
      />
    </div>
  );
}

function ResourceCountPill({
  icon: Icon,
  ariaLabel,
  total,
}: {
  icon: LucideIcon;
  ariaLabel: string;
  total: number;
}) {
  return (
    <span
      className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
      aria-label={`${ariaLabel}: ${total}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {total}
    </span>
  );
}
