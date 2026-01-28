"use client";

import { AgentWithRelations } from "@sokosumi/database";
import { useCallback, useMemo, useState } from "react";

import AgentIcon from "@/components/agents/agent-icon";
import { Button } from "@/components/ui/button";
import type {
  MentionRecordEntry,
  NormalizedMention,
} from "@/components/ui/mention-textarea";
import { MentionTextarea } from "@/components/ui/mention-textarea";
import type { OrchestratorOption } from "@/lib/types/orchestrator";

import { FileUploadButton } from "./file-upload-button";
import { OrchestratorSelect } from "./orchestrator-select";

interface NewTaskFormLabels {
  pageTitle: string;
  details: string;
  detailsDescription: string;
  descriptionPlaceholder: string;
  orchestrator: string;
  orchestratorDescription: string;
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
  const [description, setDescription] = useState("");
  const [orchestratorId, setOrchestratorId] = useState<string>(
    orchestratorOptions[0]?.id ?? "",
  );

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

  const handleFileUpload = () => {
    // TODO: implement file upload
  };

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-center gap-2">
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

        <div className="flex w-full items-start justify-between gap-2 space-y-4">
          <OrchestratorSelect
            label={labels.orchestrator}
            description={labels.orchestratorDescription}
            value={orchestratorId}
            options={orchestratorOptions}
            onChange={setOrchestratorId}
          />
        </div>
      </section>

      <div className="flex items-center gap-3 pt-4">
        <Button type="button" className="min-w-28">
          {labels.saveDraft}
        </Button>
        <Button type="button" variant="outline" className="min-w-24">
          {labels.cancel}
        </Button>
      </div>
    </div>
  );
}
