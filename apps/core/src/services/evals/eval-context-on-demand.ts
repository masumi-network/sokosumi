import { DAY_MS } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import { upsertContact } from "@/services/contacts.service";
import type { LabScenario } from "@/services/soko-bot-lab-scenario.service";
import type { EvalLaneRecord } from "./eval-lanes.service";

/**
 * Cases where the right item lies outside any packet (v38, ADR 0086): a Task
 * from three weeks ago behind a full board, an answer from an earlier
 * conversation behind newer ones, and a contact. A bot must read it; one that
 * answers from its packet finds nothing.
 */

const OLD_TASK = "Renew the Hetzner storage box contract";
const OLD_TASK_NOTE =
  "Hetzner offered 1,240 EUR a year for the 10 TB box; waiting for their signed contract.";
const OLD_DECISION =
  "Agreed: the Lisbon offsite budget is 14,500 EUR, flights not included.";
const CONTACT_EMAIL = "ilse.vandermeer@noordlicht-studio.example";
/** More recent work than any packet shows, so the old item is never in it. */
const NEWER_TASKS = 30;
const NEWER_TURNS = 14;

export const CONTEXT_ON_DEMAND_SCENARIOS: LabScenario[] = [
  {
    id: "finds-old-task",
    title: "Finds a Task from three weeks ago",
    intent:
      "Reads the board for an old Task its packet does not show, instead of saying there is none.",
    prompt:
      "Where are we with the Hetzner storage contract renewal I set up a few weeks ago?",
    rubric: `The bot looked the Task up (list_tasks with a query, or get_task_status) and answered from it: the Task "${OLD_TASK}" waits on Hetzner (AWAITING_EXTERNAL), who offered 1,240 EUR a year for the 10 TB box and are to send the signed contract. Saying no such Task exists, or guessing a status, fails. It changes nothing.`,
    // An empty setup starts the case from a reset lane.
    setup: {},
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "CLARIFY"],
      anyTools: ["list_tasks", "get_task_status"],
      forbiddenTools: ["create_task", "hire_agent", "archive_task"],
      answerMatches: "1[.,' ]?240",
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "finds-old-conversation",
    title: "Finds what was agreed in an earlier conversation",
    intent:
      "Reads back earlier messages of the chat for an answer its packet no longer holds.",
    prompt: "What budget did we settle on for the Lisbon offsite back then?",
    rubric:
      "The bot read earlier messages of this conversation (read_context section conversation, or memory if it holds it) and answered 14,500 EUR, flights not included. Saying it has no record, or guessing a number, fails. It changes nothing.",
    setup: {},
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "CLARIFY", "MIXED"],
      anyTools: ["read_context", "read_chat", "read_memory"],
      forbiddenTools: ["create_task", "hire_agent", "update_memory"],
      answerMatches: "14[.,' ]?500",
      noDelegations: true,
    },
  },
  {
    id: "finds-contact",
    title: "Finds a contact's email in Contacts",
    intent:
      "Answers a question about a person from Contacts, which no packet carries.",
    prompt: "What's Ilse Vandermeer's email again?",
    rubric: `The bot searched Contacts (search_contacts or get_contact) and gave ${CONTACT_EMAIL}. Saying it does not know her, or inventing an address, fails. It changes nothing.`,
    setup: {},
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "CLARIFY", "MIXED"],
      anyTools: ["search_contacts", "get_contact"],
      forbiddenTools: ["upsert_contact", "update_contact", "create_task"],
      answerMatches: CONTACT_EMAIL.replaceAll(".", "\\."),
      noDelegations: true,
    },
  },
];

export function isContextOnDemandCase(id: string): boolean {
  return CONTEXT_ON_DEMAND_SCENARIOS.some((scenario) => scenario.id === id);
}

function task(lane: EvalLaneRecord, at: Date, name: string, status: string) {
  return prisma.task.create({
    data: {
      name,
      status: status as "RUNNING",
      workspaceId: lane.workspaceId,
      organizationId: lane.organizationId,
      ownerId: lane.userId,
      creatorUserId: lane.userId,
      createdAt: at,
      updatedAt: at,
    },
  });
}

function turn(
  lane: EvalLaneRecord,
  at: Date,
  userMessage: string,
  finalAnswer: string,
) {
  return prisma.sokoBotTurn.create({
    data: {
      sokoBotId: lane.sokoBotId,
      workspaceId: lane.workspaceId,
      requestedByUserId: lane.userId,
      source: "CHAT",
      status: "COMPLETED",
      route: "DIRECT_RESPONSE",
      clientTurnId: `lab:seed:${at.getTime()}:${Math.random()}`,
      userMessage,
      finalAnswer,
      deadlineAt: at,
      createdAt: at,
      completedAt: at,
    },
  });
}

/** Seeds the old item behind newer ones; the lane was reset just before. */
export async function prepareContextOnDemandCase(
  lane: EvalLaneRecord,
  scenarioId: string,
): Promise<void> {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY_MS);
  if (scenarioId === "finds-old-task") {
    // Waiting on Hetzner, not on Robin: the packet's waiting list skips it.
    const old = await task(lane, ago(21), OLD_TASK, "AWAITING_EXTERNAL");
    await prisma.taskEvent.create({
      data: {
        taskId: old.id,
        status: "AWAITING_EXTERNAL",
        comment: OLD_TASK_NOTE,
        userId: lane.userId,
        createdAt: ago(21),
      },
    });
    for (let index = 0; index < NEWER_TASKS; index += 1)
      await task(
        lane,
        new Date(now - (index + 1) * 3_600_000),
        `Draft section ${index + 1} of the partner handbook`,
        "RUNNING",
      );
    return;
  }
  if (scenarioId === "finds-old-conversation") {
    await turn(
      lane,
      ago(18),
      "Let's fix the Lisbon offsite budget: 14,500 EUR without flights?",
      OLD_DECISION,
    );
    for (let index = 0; index < NEWER_TURNS; index += 1)
      await turn(
        lane,
        new Date(now - (NEWER_TURNS - index) * 3_600_000),
        `Quick check ${index + 1}: anything new on the partner handbook?`,
        `Nothing new on the partner handbook since check ${index}.`,
      );
    return;
  }
  if (scenarioId === "finds-contact")
    await upsertContact(
      prisma,
      {
        workspaceId: lane.workspaceId,
        userId: lane.userId,
        sokoBotId: lane.sokoBotId,
      },
      {
        upsert: true,
        name: "Ilse Vandermeer",
        organization: "Noordlicht Studio",
        role: "Creative director",
        channels: [{ type: "EMAIL", value: CONTACT_EMAIL }],
      },
    );
}
