import { randomUUID } from "node:crypto";
import { expect, it, onTestFinished } from "vitest";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import { composeHandoff } from "./chat-message-handoff";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

it.skipIf(!enabled)(
  "includes the stored project briefing in the handoff",
  async () => {
    const id = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    // The project and calendar fixture triggers resolve tables on the search path.
    const fixturePath = () =>
      prisma.$queryRaw`SELECT set_config('search_path', quote_ident(${getEnv().DATABASE_SCHEMA_SHARED}::text) || ', public', true)`;
    await prisma.$transaction([
      fixturePath(),
      prisma.user.create({
        data: {
          id,
          name: "Fixture owner",
          email: `handoff-${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspaceId } },
        },
      }),
      prisma.project.create({
        data: {
          id: projectId,
          workspaceId,
          name: "Release",
          briefing: "Explain the release to teams.",
        },
      }),
    ]);
    onTestFinished(async () => {
      await prisma.$transaction([
        fixturePath(),
        prisma.user.delete({ where: { id } }),
      ]);
    });
    const authorized = {
      turn: { workspaceId, actingUserId: id },
    } as AuthorizedSokoBotRuntime;
    const result = await composeHandoff(authorized, {
      message: "Can you write the launch note?",
      request: { goal: "Write the launch note" },
      projectId,
    });
    expect(result.handoff).toBe(true);
    expect(result.message).toContain(
      'Project "Release": Explain the release to teams.',
    );
  },
);
