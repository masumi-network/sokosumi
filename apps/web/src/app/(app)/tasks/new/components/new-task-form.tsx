"use client";

import { AgentWithRelations, TaskStatus } from "@sokosumi/database";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import AgentIcon from "@/components/agents/agent-icon";
import { Button } from "@/components/ui/button";
import type {
  MentionRecordEntry,
  NormalizedMention,
} from "@/components/ui/mention-textarea";
import { MentionTextarea } from "@/components/ui/mention-textarea";
import { createTask } from "@/lib/actions/task/action";
import type { OrchestratorOption } from "@/lib/types/orchestrator";

import { FileUploadButton } from "./file-upload-button";
import { OrchestratorSelect } from "./orchestrator-select";
import { StatusSelect } from "./status-select";

interface NewTaskFormLabels {
  pageTitle: string;
  details: string;
  detailsDescription: string;
  descriptionPlaceholder: string;
  orchestrator: string;
  orchestratorDescription: string;
  status: string;
  statusDescription: string;
  statusDraft: string;
  statusReady: string;
  back: string;
  uploadFile: string;
  saveDraft: string;
  cancel: string;
}

interface NewTaskFormProps {
  labels: NewTaskFormLabels;
  orchestratorOptions: OrchestratorOption[];
  agents: AgentWithRelations[];
}

export function NewTaskForm({
  labels,
  orchestratorOptions,
  agents,
}: NewTaskFormProps) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [orchestratorId, setOrchestratorId] = useState<string>(
    orchestratorOptions[0]?.id ?? "",
  );
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.DRAFT);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const selectedOrchestratorName =
    orchestratorOptions.find((option) => option.id === orchestratorId)?.name ??
    "";

  const isSaveDisabled = !description.trim() || isSubmitting;

  const handleFileUpload = () => {
    // TODO: implement file upload
  };

  const handleSave = async () => {
    if (isSaveDisabled) return;
    setIsSubmitting(true);
    try {
      const result = await createTask({
        description,
        orchestratorId,
        orchestratorName: selectedOrchestratorName || "Task",
        status,
      });
      router.push(`/tasks/${result.taskId}`);
    } catch (error) {
      console.error("Failed to create task", error);
      toast.error("Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
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

        <div className="flex w-full items-center justify-end gap-2">
          <FileUploadButton
            label={labels.uploadFile}
            onClick={handleFileUpload}
          />
        </div>

        <div className="flex w-full flex-col items-start gap-4 md:flex-row md:justify-between">
          <OrchestratorSelect
            label={labels.orchestrator}
            description={labels.orchestratorDescription}
            value={orchestratorId}
            options={orchestratorOptions}
            onChange={setOrchestratorId}
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
          className="min-w-28"
          disabled={isSaveDisabled}
          onClick={handleSave}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : null}
          {labels.saveDraft}
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
