"use client";

import { isEmptyOrValidWebsiteUrl, normalizeWebsiteUrl } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ProjectBrandSetup } from "@/app/projects/components/project-brand-setup";
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
  websiteUrl?: string | null;
}

interface ProjectFormProps {
  children?: ReactNode;
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
  children,
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
  const t = useTranslations("App.Projects");
  const isModal = variant === "modal";
  const [name, setName] = useState(initialValues?.name ?? "");
  const [website, setWebsite] = useState(initialValues?.websiteUrl ?? "");
  const [briefing, setBriefing] = useState(initialValues?.briefing ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brandSetupUrl, setBrandSetupUrl] = useState<string | null>(null);
  const isWebsiteValid = isEmptyOrValidWebsiteUrl(website);
  const isSubmitDisabled = !name.trim() || !isWebsiteValid || isSubmitting;

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
      const normalizedWebsite = normalizeWebsiteUrl(website);
      const previousWebsite = initialValues?.websiteUrl ?? null;
      const input = {
        name: trimmedName,
        briefing: briefing.trim() || null,
        websiteUrl: normalizedWebsite,
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

      const websiteChanged = normalizedWebsite !== previousWebsite;
      if (mode === "edit" && projectId && normalizedWebsite && websiteChanged) {
        setBrandSetupUrl(normalizedWebsite);
        return;
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
          {brandSetupUrl && projectId ? (
            <div className="py-6">
              <ProjectBrandSetup
                projectId={projectId}
                projectName={name.trim()}
                websiteUrl={brandSetupUrl}
              />
            </div>
          ) : (
            <>
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

              <div className="space-y-2">
                <Label htmlFor="project-website">
                  {t("Wizard.name.websiteLabel")}
                </Label>
                <Input
                  id="project-website"
                  inputMode="url"
                  placeholder={t("Wizard.name.websitePlaceholder")}
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={!isWebsiteValid}
                />
                <p className="text-muted-foreground/70 text-xs leading-relaxed">
                  {t("Wizard.name.websiteHint")}
                </p>
              </div>

              <ProjectBriefingField
                value={briefing}
                onChange={setBriefing}
                disabled={isSubmitting}
              />
            </>
          )}
          {children}
        </div>

        <div
          className={
            isModal
              ? "flex shrink-0 justify-end gap-3 border-t px-6 py-4"
              : "flex justify-end gap-3 border-t px-6 py-6"
          }
        >
          {brandSetupUrl ? (
            <Button
              type="button"
              onClick={() => {
                if (onSuccess && projectId) {
                  onSuccess(projectId, name.trim());
                  return;
                }
                router.push(`/projects/${projectId}`);
              }}
            >
              {t("Wizard.nav.openProject")}
            </Button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </section>
    </form>
  );
}
