import { describe, expect, it } from "vitest";

import { createTaskJobRequestSchema } from "./task.schema";

const validInputSchema = {
  input_data: [
    {
      id: "prompt",
      type: "string",
      name: "Prompt",
      data: null,
      validations: null,
    },
  ],
};

describe("createTaskJobRequestSchema", () => {
  it("accepts minimal valid payload", () => {
    const result = createTaskJobRequestSchema.parse({
      agentId: "agent_123",
      inputSchema: validInputSchema,
      inputData: { prompt: "Hello" },
    });

    expect(result.agentId).toBe("agent_123");
  });

  it("rejects missing agentId", () => {
    expect(() => {
      createTaskJobRequestSchema.parse({
        inputSchema: validInputSchema,
        inputData: { prompt: "Hello" },
      });
    }).toThrow();
  });

  it("rejects missing inputSchema", () => {
    expect(() => {
      createTaskJobRequestSchema.parse({
        agentId: "agent_123",
        inputData: { prompt: "Hello" },
      });
    }).toThrow();
  });

  it("rejects missing inputData", () => {
    expect(() => {
      createTaskJobRequestSchema.parse({
        agentId: "agent_123",
        inputSchema: validInputSchema,
      });
    }).toThrow();
  });
});
