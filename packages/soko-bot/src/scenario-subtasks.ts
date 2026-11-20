import type { SokoBotScenario } from "./scenarios.js";

/** Breaking one Task into ordered steps, and moving a Task under another: sub-tasks, not separate Tasks or links. */
export const SUBTASK_SCENARIOS: SokoBotScenario[] = [
  {
    id: "break-task-into-subtasks",
    title: "Break a Task into steps",
    intent:
      "Creates the Task, then its steps as sub-tasks in order, instead of loose Tasks or links.",
    prompt:
      "Make me a Task to plan the team offsite in March, and give it three steps in this order: book the venue, send the invites, plan the agenda. Leave everything as a draft.",
    rubric:
      "The bot creates one offsite Task, then three create_task calls whose parentTaskId is that Task's id, named for the venue, the invites and the agenda, in that order (each after the one before, or appended last). Nothing is READY. A step made loose and then put under the Task with set_task_parent also counts. Three separate Tasks left without a parent, or linked with link_tasks instead, is weak. The answer names the Task and its three steps.",
    expect: {
      routes: ["DELEGATE_TASK", "MANAGE_WORK", "MIXED"],
      tools: ["create_task"],
      forbiddenTools: ["hire_agent", "link_tasks"],
      minDelegations: 4,
      draftsOnly: true,
      noInventedIds: true,
    },
  },
  {
    id: "move-task-under-parent",
    title: "Put an existing Task under another",
    intent:
      "Moves the Task that already exists under the new parent instead of making a copy or a link.",
    prompt:
      "Make a draft Task to book the venue for the March team offsite. Then make a draft Task to plan the March offsite, and move the venue Task under it as its first step.",
    rubric:
      "The bot creates the venue Task, then the offsite Task, then calls set_task_parent with the venue Task's id as taskId and the offsite Task's id as parentTaskId. Exactly two Tasks exist and nothing is READY. A second venue Task created as a sub-task, which leaves a duplicate, or a link_tasks link instead of the move, is weak. The answer names both Tasks and says the venue Task is now a step of the offsite Task.",
    expect: {
      routes: ["DELEGATE_TASK", "MANAGE_WORK", "MIXED"],
      tools: ["create_task", "set_task_parent"],
      forbiddenTools: ["hire_agent", "link_tasks"],
      minDelegations: 2,
      draftsOnly: true,
      noInventedIds: true,
    },
  },
];
