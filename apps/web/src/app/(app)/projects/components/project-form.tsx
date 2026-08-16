"use client";

import { track } from "@vercel/analytics";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { ProjectBriefingField } from "@/app/projects/components/project-briefing-field";
import { PROJECT_NAME_MAX_LENGTH } from "@/app/projects/project-briefing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject, updateProject } from "@/lib/actions/project/action";

export type ProjectCreationSource = "projects_page" | "task_form";

export interface ProjectFormLabels {
  details: string;
  detailsDescription: string;
  name: string;
  namePlaceholder: string;
  submit: string;
  cancel: string;
  error: string;
}

interface ProjectFormInitialValues {
  name?: string;
  briefing?: string | null;
}

interface ProjectFormProps {
  mode: "create" | "edit";
  labels: ProjectFormLabels;
  projectId?: string;
  initialValues?: ProjectFormInitialValues;
  variant?: "page" | "modal";
  showCancel?: boolean;
  onCancel?: () => void;
  onSuccess?: (projectId: string, name: string) => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  creationSource?: ProjectCreationSource;
}

export function ProjectForm({
  mode,
  labels,
  projectId,
  initialValues,
  variant = "page",
  showCancel = true,
  onCancel,
  onSuccess,
  onSubmittingChange,
  creationSource,
}: ProjectFormProps) {
  const router = useRouter();
  const isModal = variant === "modal";
  const [name, setName] = useState(initialValues?.name ?? "");
  const [briefing, setBriefing] = useState(initialValues?.briefing ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmitDisabled = !name.trim() || isSubmitting;

  function updateSubmitting(nextIsSubmitting: boolean) {
    setIsSubmitting(nextIsSubmitting);
    onSubmittingChange?.(nextIsSubmitting);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) return;

    updateSubmitting(true);
    try {
      const trimmedName = name.trim();
      const input = {
        name: trimmedName,
        briefing: briefing.trim() || null,
      };

      const result =
        mode === "create"
          ? await createProject(input)
          : await updateProject({
              projectId: projectId ?? "",
              ...input,
            });

      if (mode === "create" && creationSource) {
        track("Project created", {
          source: creationSource,
          variant,
        });
      }

      if (onSuccess) {
        onSuccess(result.projectId, trimmedName);
        return;
      }

      router.push(`/projects/${result.projectId}`);
    } catch (error) {
      console.error("Failed to save project", error);
      toast.error(labels.error);
    } finally {
      updateSubmitting(false);
    }
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
      return;
    }

    router.push(projectId ? `/projects/${projectId}` : "/projects");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={
        isModal ? "flex min-h-0 flex-1 flex-col" : "max-w-3xl space-y-6"
      }
    >
      <section
        className={
          isModal ? "flex min-h-0 flex-1 flex-col" : "rounded-xl border"
        }
      >
        {!isModal ? (
          <div className="space-y-1 p-6">
            <h2 className="text-lg font-semibold">{labels.details}</h2>
            <p className="text-muted-foreground text-sm">
              {labels.detailsDescription}
            </p>
          </div>
        ) : null}

        <div
          className={
            isModal
              ? "flex min-h-0 flex-1 flex-col overflow-y-auto space-y-4 px-6 py-5"
              : "space-y-4 border-t px-6 py-6"
          }
        >
          <div className="space-y-2">
            <Label htmlFor="project-name">{labels.name}</Label>
            <Input
              id="project-name"
              maxLength={PROJECT_NAME_MAX_LENGTH}
              placeholder={labels.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <ProjectBriefingField
            value={briefing}
            onChange={setBriefing}
            disabled={isSubmitting}
          />
        </div>

        <div
          className={
            isModal
              ? "flex shrink-0 justify-end gap-3 border-t px-6 py-4"
              : "flex justify-end gap-3 border-t px-6 py-6"
          }
        >
          {showCancel ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              {labels.cancel}
            </Button>
          ) : null}
          <Button type="submit" disabled={isSubmitDisabled}>
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {labels.submit}
          </Button>
        </div>
      </section>
    </form>
  );
}
