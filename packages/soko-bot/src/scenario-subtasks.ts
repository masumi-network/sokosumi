import type { SokoBotScenario } from "./scenarios.js";

/** Breaking one Task into ordered steps: sub-tasks, not separate Tasks. */
export const SUBTASK_SCENARIOS: SokoBotScenario[] = [
  {
    id: "break-task-into-subtasks",
    title: "Break a Task into steps",
    intent:
      "Creates the Task, then its steps as sub-tasks in order, instead of loose Tasks or links.",
    prompt:
      "Make me a Task to plan the team offsite in March, and give it three steps in this order: book the venue, send the invites, plan the agenda. Leave everything as a draft.",
    rubric:
      "The bot creates one offsite Task, then three create_task calls whose parentTaskId is that Task's id, named for the venue, the invites and the agenda, in that order (each after the one before, or appended last). Nothing is READY or assigned. Three separate Tasks without parentTaskId, or linking them with link_tasks instead, is weak. The answer names the Task and its three steps.",
    expect: {
      routes: ["DELEGATE_TASK", "MANAGE_WORK", "MIXED"],
      tools: ["create_task"],
      forbiddenTools: ["hire_agent", "link_tasks"],
      minDelegations: 4,
      draftsOnly: true,
      noInventedIds: true,
    },
  },
];
