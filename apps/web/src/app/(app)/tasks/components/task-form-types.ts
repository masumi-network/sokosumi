import {
  type Task,
  type TaskPriority,
  TaskStatus,
  type TaskTagId,
} from "@sokosumi/core-client";
import type { CelebrationTaskStatus } from "@/app/tasks/components/task-created-celebration";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  type CreateTaskResult,
  type TaskContextSelectionInput,
} from "@/lib/actions/task/action";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import type { CoworkerOption } from "@/lib/types/coworker";

export interface TaskFormLabels {
  details: string;
  detailsDescription: string;
  name: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  projectLabel: string;
  projectNone: string;
  projectSearchPlaceholder: string;
  projectEmptyResults: string;
  projectCreate?: string;
  projectCreateNamed?: string;
  projectPlaceholder?: string;
  projectRequired?: string;
  coworker: string;
  unassigned: string;
  unavailableAssignee: string;
  changeCoworker: string;
  noCoworkerMatches: string;
  status: string;
  statusDescription: string;
  statusDraft: string;
  statusQueued: string;
  statusReady: string;
  statusLabels?: Record<TaskStatus, string>;
  changeStatus: string;
  noStatusMatches: string;
  uploadFile: string;
  uploadFileError?: string;
  uploadingFile: string;
  uploadingFiles: string;
  removeAttachment: string;
  submit: string;
  createTask?: string;
  scheduleTask?: string;
  openRunAt: string;
  cancel: string;
  ctrl: string;
  taskCreated?: string;
  taskCreatedHint?: Record<CelebrationTaskStatus, string>;
  goToTask?: string;
  createAnother?: string;
  untitledTask: string;
  saveError: string;
  privateLabel?: string;
  privateDescription?: string;
  /** Under the assignee picker of a Private copy. */
  privateOtherPeopleHint?: string;
}

export type TaskFormTagPrefill = Pick<Task, "tags" | "workspaceTags">;

interface TaskFormInitialValues extends TaskFormTagPrefill {
  name?: string;
  description?: string;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  status?: TaskStatus;
  /** Statuses Core lets this viewer move the Task to; edit mode only (ADR 0029). */
  selectableStatuses?: readonly TaskStatus[];
  /** The Task's Run at as an ISO string; set only while it is Queued. */
  runAt?: string | null;
  /** Create only: start with Private on (a copy of a private Task). */
  visibility?: "PUBLIC" | "PRIVATE";
  /** Create only: this form makes a copy of that Task ("Duplicate"). */
  copyOfTaskId?: string;
}

export type TaskFormInitialDesignMdAttachment = EffectiveDesignMdAttachment;

export interface TaskFormCreateInput {
  dismissedTopicIds?: TaskTagId[];
  workspaceTagIds?: string[];
  dismissedWorkspaceTagIds?: string[];
  tagSuggestionReceipt?: string;
  copyOfTaskId?: string;
  name?: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  projectId?: string | null;
  context: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  /** ISO time the Task starts at; set only with status Queued. */
  runAt?: string;
  visibility?: "PUBLIC" | "PRIVATE";
  priority?: TaskPriority;
  /** `YYYY-MM-DD`. */
  dueOn?: string;
}

export type TaskFormCreateHandler = (
  input: TaskFormCreateInput,
) => Promise<CreateTaskResult>;

export interface TaskFormProps {
  mode: "create" | "edit";
  labels: TaskFormLabels;
  coworkerOptions: CoworkerOption[];
  agentNameById?: Map<string, string>;
  taskId?: string;
  initialValues?: TaskFormInitialValues;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  projectOptions?: ProjectFilterOption[];
  lockProjectSelection?: boolean;
  defaultProjectId?: string | null;
  onCancel?: () => void;
  onSuccess?: (task: {
    id: string;
    identifier: string | null;
    name: string;
  }) => void;
  /** Runs right after a modal create succeeds (before the celebration step). */
  onCreated?: (taskId: string) => void;
  onCreateAnother?: () => void;
  onCreateTask?: TaskFormCreateHandler;
  showCancel?: boolean;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  onCreatedChange?: (created: boolean) => void;
  /** Whether the title or description differs from how the form opened. */
  onDirtyChange?: (dirty: boolean) => void;
}
