import { expectConsole } from "@sokosumi/utils/test-console";
import { stepCountIs, streamText, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  setReferenceScript,
  takeScriptErrors,
  worldCheckJevAnswers,
  worldCheckMode,
  worldCheckModel,
} from "./world-check";

const ROUTE_QUESTIONS = {
  route: {
    type: "choice" as const,
    criteria: { DIRECT_RESPONSE: "", MANAGE_WORK: "" },
  },
  writeScope: { type: "choice" as const, criteria: { MEMORY: "", SOCIAL: "" } },
  aboutMail: { type: "boolean" as const },
};

async function play(message: string) {
  const calls: unknown[] = [];
  const result = streamText({
    model: worldCheckModel(message, "turn-1"),
    prompt: message,
    stopWhen: stepCountIs(5),
    tools: {
      create_social_post: tool({
        inputSchema: z.object({ text: z.string() }),
        execute: async (input) => {
          calls.push(input);
          return { postId: "post-1" };
        },
      }),
    },
  });
  return { text: await result.text, calls };
}

describe("world check", () => {
  afterEach(() => {
    delete process.env.OWNERBENCH_WORLD_CHECK;
    setReferenceScript({ turns: [] });
  });

  it("is off unless asked for, and never on a deployment", () => {
    expect(worldCheckMode({})).toBeNull();
    expect(worldCheckMode({ OWNERBENCH_WORLD_CHECK: "noop" })).toBe("noop");
    expect(
      worldCheckMode({ OWNERBENCH_WORLD_CHECK: "noop", VERCEL: "1" }),
    ).toBeNull();
  });

  it("answers OK with no tools when doing nothing", async () => {
    process.env.OWNERBENCH_WORLD_CHECK = "noop";
    setReferenceScript({
      turns: [{ match: "Post", steps: [() => "should not play"] }],
    });
    expect(await play("Post this")).toEqual({ text: "OK", calls: [] });
  });

  it("plays the matching script's tool calls through the tools, then its answer", async () => {
    process.env.OWNERBENCH_WORLD_CHECK = "reference";
    setReferenceScript({
      turns: [
        {
          match: "Post this",
          steps: [
            () => [{ tool: "create_social_post", input: { text: "Hi" } }],
            (results) =>
              `Drafted ${(results[0] as { postId: string }).postId}.`,
          ],
        },
      ],
    });
    expect(await play("Please Post this on X")).toEqual({
      text: "Drafted post-1.",
      calls: [{ text: "Hi" }],
    });
  });

  it("plays the newest message's script when the message quotes earlier ones", async () => {
    process.env.OWNERBENCH_WORLD_CHECK = "reference";
    setReferenceScript({
      turns: [
        { match: "Post this", steps: [() => "first"] },
        { match: "Make it shorter", steps: [() => "second"] },
      ],
    });
    expect(
      (await play("CONTEXT: - Owner: Post this\n\nOwner: Make it shorter"))
        .text,
    ).toBe("second");
  });

  it("records a script step that throws, so the run is not read as a pass", async () => {
    process.env.OWNERBENCH_WORLD_CHECK = "reference";
    // The SDK logs the stream's error; that error is this test's subject.
    expectConsole("error", "Error: no posts");
    takeScriptErrors();
    setReferenceScript({
      turns: [
        {
          match: "Post this",
          steps: [
            () => {
              throw new Error("no posts");
            },
          ],
        },
      ],
    });
    await play("Post this").catch(() => undefined);
    expect(takeScriptErrors()).toEqual(['step 0 of "Post this": no posts']);
  });

  it("gives Jev the script's route, its overrides, and neutral answers otherwise", () => {
    process.env.OWNERBENCH_WORLD_CHECK = "reference";
    setReferenceScript({
      turns: [
        {
          match: "Post this",
          route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
          steps: [],
        },
      ],
      jev: { aboutMail: 0.9 },
    });
    expect(worldCheckJevAnswers("Post this", ROUTE_QUESTIONS)).toEqual({
      route: {
        choice: "MANAGE_WORK",
        probabilities: { DIRECT_RESPONSE: 0, MANAGE_WORK: 1 },
      },
      writeScope: { choice: "SOCIAL", probabilities: { MEMORY: 0, SOCIAL: 1 } },
      aboutMail: { probability: 0.9 },
    });
    process.env.OWNERBENCH_WORLD_CHECK = "noop";
    expect(worldCheckJevAnswers("Post this", ROUTE_QUESTIONS)).toMatchObject({
      route: { choice: "DIRECT_RESPONSE" },
      aboutMail: { probability: 0 },
    });
  });
});
