import { AgentWithRelations } from "@sokosumi/database";

import {
  TaskForm,
  type TaskFormLabels,
} from "@/app/tasks/components/task-form";
import type { OrchestratorOption } from "@/lib/types/orchestrator";

type NewTaskFormLabels = TaskFormLabels;

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
  return (
    <TaskForm
      mode="create"
      labels={labels}
      orchestratorOptions={orchestratorOptions}
      agents={agents}
    />
  );
}
