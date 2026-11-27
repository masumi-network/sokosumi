import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import { describe, expect, it } from "vitest";
import {
  EVAL_AGENT_BASE_URL,
  EVAL_AGENT_INPUT_SCHEMA,
  isEvalAgentBaseUrl,
} from "./fake-agent";

describe("the eval Agent", () => {
  it("answers with an input schema Core accepts", () => {
    expect(inputSchemaSchema.safeParse(EVAL_AGENT_INPUT_SCHEMA).success).toBe(
      true,
    );
  });

  it("is only the eval host, never a real Agent's", () => {
    expect(isEvalAgentBaseUrl(EVAL_AGENT_BASE_URL)).toBe(true);
    expect(isEvalAgentBaseUrl(` ${EVAL_AGENT_BASE_URL} `)).toBe(true);
    expect(isEvalAgentBaseUrl("https://agent.example.com")).toBe(false);
    expect(isEvalAgentBaseUrl(null)).toBe(false);
  });
});
