import type { TaskFormCreateInput } from "@/app/tasks/components/task-form";
import type {
  TaskAssigneeView,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { getColumnId } from "@/app/tasks/utils/task-column";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import type { CoworkerOption } from "@/lib/types/coworker";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

const PENDING_TASK_ID_PREFIX = "pending:";
/**
 * Shown when the form has no name and no description line to show. The
 * board path in `use-pending-created-tasks.ts` replaces it with the
 * translated untitled label, so this is only the default for direct
 * `buildPendingTask` callers.
 */
const PENDING_TASK_NAME_FALLBACK = "…";
/** The length the server cuts a row's plain description to. */
const PLAIN_DESCRIPTION_LENGTH = 200;

interface PendingTaskOptions {
  coworkerOptions: ReadonlyArray<CoworkerOption>;
  projectOptions: ReadonlyArray<ProjectFilterOption>;
  now?: Date;
}

function resolveAssignee(
  input: TaskFormCreateInput,
  coworkerOptions: ReadonlyArray<CoworkerOption>,
): TaskAssigneeView | null {
  const assigneeId =
    input.assigneeId ?? input.assigneeSokoBotId ?? input.assigneeUserId;
  const option = coworkerOptions.find((item) => item.id === assigneeId);
  if (!option) return null;
  return {
    id: option.id,
    name: option.name,
    image: option.image,
    slug: option.slug,
    kind: option.kind ?? "coworker",
    avatarSeed: option.avatarSeed,
  };
}

/**
 * The name a pending row shows: the form's name, else the first description
 * line. Null when both are empty.
 */
export function getPendingTaskName(
  input: Pick<TaskFormCreateInput, "name" | "description">,
): string | null {
  const firstDescriptionLine = stripMarkdownToText(
    input.description.trim().split("\n", 1)[0],
  );
  return input.name || firstDescriptionLine || null;
}

/**
 * The board row for a Task whose create request is still on the wire. The
 * server writes the name of an unnamed Task, so the first description line
 * stands in for it until the real row arrives.
 */
export function buildPendingTask(
  input: TaskFormCreateInput,
  { coworkerOptions, projectOptions, now = new Date() }: PendingTaskOptions,
): TaskWithCoworker {
  const descriptionPlain = stripMarkdownToText(input.description);
  const project = projectOptions.find((item) => item.id === input.projectId);
  const timestamp = now.toISOString();
  return {
    id: `${PENDING_TASK_ID_PREFIX}${crypto.randomUUID()}`,
    isPending: true,
    identifier: null,
    name: getPendingTaskName(input) ?? PENDING_TASK_NAME_FALLBACK,
    status: input.status,
    priority: "NONE",
    visibility: input.visibility ?? "PUBLIC",
    ownerId: null,
    owner: null,
    project: project
      ? {
          id: project.id,
          name: project.name,
          identifier: null,
          logo: project.logo ?? null,
        }
      : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    jobsCount: 0,
    assignee: resolveAssignee(input, coworkerOptions),
    participants: [],
    commentsCount: 0,
    columnId: getColumnId(input.status),
    descriptionPlain:
      descriptionPlain?.slice(0, PLAIN_DESCRIPTION_LENGTH) || null,
    events: [],
    agents: [],
    runAt: input.runAt ?? null,
  };
}
