import { expect, it } from "vitest";
import { hideDrawingInputs } from "./drawing-stream";

it("hides drawing inputs on both live and resumed Eve streams while preserving line positions", async () => {
  const progress = (data: object) => ({
    progress: { type: "call.input", data },
  });
  const records = [
    progress({ callId: "resumed", delta: "hidden-tail" }),
    progress({
      callId: "other",
      name: "generate_image",
      delta: "visible-prompt",
    }),
    progress({ callId: "draw", name: "draw_svg", delta: "hidden-start" }),
    progress({ callId: "draw", delta: "hidden-markup" }),
    {
      facts: [
        {
          type: "call.requested",
          data: {
            callId: "draw",
            capability: { name: "draw_svg" },
            input: { svg: "hidden-svg" },
            inputRef: "hidden-ref",
            inputError: "hidden-validation-error",
          },
        },
      ],
    },
    {
      facts: [
        {
          type: "call.settled",
          data: {
            callId: "draw",
            outcome: "failed",
            output: "hidden-output",
            outputRef: "hidden-ref",
            error: { message: "hidden-arguments" },
          },
        },
      ],
    },
    { $eve: "position", next: 6 },
  ];
  const response = hideDrawingInputs(
    new Response(records.map((line) => JSON.stringify(line)).join("\n"), {
      headers: { "content-type": "application/x-ndjson" },
    }),
  );
  const body = await response.text();
  expect(body).not.toContain("hidden");
  expect(body).toContain("visible-prompt");
  expect(body.trim().split("\n")).toHaveLength(records.length);
});
