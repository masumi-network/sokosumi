"use client";

import { AgentWithRelations, TaskStatus } from "@sokosumi/database";
import { ArrowLeft, Command, CornerDownLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

// TODO: Add file attachment
// import { FileUploadButton } from "@/app/tasks/new/components/file-upload-button";
import { CoworkerSelect } from "@/app/tasks/new/components/coworker-select";
import { StatusSelect } from "@/app/tasks/new/components/status-select";
import AgentIcon from "@/components/agents/agent-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  MentionRecordEntry,
  NormalizedMention,
} from "@/components/ui/mention-textarea";
import { MentionTextarea } from "@/components/ui/mention-textarea";
import { useOSDetection } from "@/hooks/use-os-detection";
import { createTask, updateTask } from "@/lib/actions/task/action";
import type { CoworkerOption } from "@/lib/types/coworker";

export interface TaskFormLabels {
  pageTitle: string;
  details: string;
  detailsDescription: string;
  name: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  coworker: string;
  coworkerDescription: string;
  status: string;
  statusDescription: string;
  statusDraft: string;
  statusReady: string;
  back: string;
  uploadFile: string;
  submit: string;
  cancel: string;
  ctrl: string;
}

interface TaskFormInitialValues {
  name?: string;
  description?: string;
  coworkerId?: string | null;
  status?: TaskStatus;
}

interface TaskFormProps {
  mode: "create" | "edit";
  labels: TaskFormLabels;
  coworkerOptions: CoworkerOption[];
  agents: AgentWithRelations[];
  taskId?: string;
  initialValues?: TaskFormInitialValues;
}

export function TaskForm({
  mode,
  labels,
  coworkerOptions,
  agents,
  taskId,
  initialValues,
}: TaskFormProps) {
  const router = useRouter();
  const originalStatus = initialValues?.status ?? TaskStatus.DRAFT;
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [coworkerId, setCoworkerId] = useState<string>(
    initialValues?.coworkerId ?? coworkerOptions[0]?.id ?? "",
  );
  const [status, setStatus] = useState<TaskStatus>(originalStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { os, isMobile } = useOSDetection();

  const agentMentions = useMemo(() => {
    const record: Record<string, MentionRecordEntry<AgentWithRelations>> = {};
    for (const agent of agents) {
      record[agent.id] = {
        value: agent.name,
        data: agent,
      };
    }
    return record;
  }, [agents]);

  const renderMentionItem = useCallback(
    (mention: NormalizedMention<AgentWithRelations>, _isActive: boolean) => {
      const agent = mention.data;
      if (!agent) {
        return (
          <div className="flex items-center gap-2 truncate">
            <span className="truncate">{mention.value}</span>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2 truncate">
          <AgentIcon agent={agent} />
          <span className="truncate">{agent.name}</span>
        </div>
      );
    },
    [],
  );

  const statusOptions = useMemo(
    () => [
      { value: TaskStatus.DRAFT, label: labels.statusDraft },
      { value: TaskStatus.READY, label: labels.statusReady },
    ],
    [labels.statusDraft, labels.statusReady],
  );

  const isNameRequired = mode === "edit";
  const isSaveDisabled =
    !description.trim() || (isNameRequired && !name.trim()) || isSubmitting;

  const handleFileUpload = () => {
    // TODO: implement file upload
  };

  const handleSave = useCallback(async () => {
    if (isSaveDisabled) return;
    setIsSubmitting(true);
    try {
      const trimmedDescription = description.trim();
      if (mode === "create") {
        const result = await createTask({
          description: trimmedDescription,
          coworkerId,
          status,
        });
        router.push(`/tasks/${result.taskId}`);
        return;
      }

      if (!taskId) {
        throw new Error("Task ID is required");
      }

      const trimmedName = name.trim();
      await updateTask({
        taskId,
        name: trimmedName,
        description: trimmedDescription,
        coworkerId,
        currentStatus: originalStatus,
        desiredStatus: status,
      });
      router.push(`/tasks/${taskId}`);
    } catch (error) {
      console.error("Failed to save task", error);
      toast.error("Failed to save task");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    description,
    isSaveDisabled,
    mode,
    name,
    coworkerId,
    originalStatus,
    router,
    status,
    taskId,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      const isSubmitKey =
        event.key === "Enter" && (event.metaKey || event.ctrlKey);
      if (!isSubmitKey) return;

      event.preventDefault();
      handleSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  const handleCancel = () => {
    if (mode === "edit" && taskId) {
      router.push(`/tasks/${taskId}`);
      return;
    }
    router.push("/tasks");
  };

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-center gap-2">
        <Link href="/tasks" aria-label={labels.back}>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={labels.back}
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">{labels.back}</span>
          </Button>
        </Link>
        <h1 className="text-2xl font-light md:text-3xl">{labels.pageTitle}</h1>
      </header>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{labels.details}</h2>
          <p className="text-muted-foreground text-sm">
            {labels.detailsDescription}
          </p>
        </div>

        {mode === "edit" ? (
          <div className="space-y-2">
            <Label htmlFor="task-name">{labels.name}</Label>
            <Input
              id="task-name"
              placeholder={labels.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <MentionTextarea<AgentWithRelations>
            id="task-description"
            placeholder={labels.descriptionPlaceholder}
            value={description}
            onChange={setDescription}
            mentions={agentMentions}
            renderItem={renderMentionItem}
            className="min-h-48"
          />
        </div>

        {/* TODO: Add file attachment */}
        {/* <div className="flex w-full items-center justify-end gap-2">
          <FileUploadButton
            label={labels.uploadFile}
            onClick={handleFileUpload}
          />
        </div> */}

        <div className="flex w-full flex-col items-start gap-4 md:flex-row md:justify-between">
          <CoworkerSelect
            label={labels.coworker}
            description={labels.coworkerDescription}
            value={coworkerId}
            options={coworkerOptions}
            onChange={setCoworkerId}
          />
          <StatusSelect
            label={labels.status}
            description={labels.statusDescription}
            value={status}
            options={statusOptions}
            onChange={setStatus}
          />
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 pt-4">
        <Button
          type="button"
          className="min-w-28 items-center justify-between gap-1"
          disabled={isSaveDisabled}
          onClick={handleSave}
        >
          <div className="flex items-center gap-2">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            {labels.submit}
            {!isMobile ? (
              <div className="flex items-center gap-1">
                {os === "MacOS" ? <Command /> : labels.ctrl}
                <CornerDownLeft />
              </div>
            ) : null}
          </div>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-w-24"
          onClick={handleCancel}
        >
          {labels.cancel}
        </Button>
      </div>
    </div>
  );
}
