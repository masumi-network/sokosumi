import type { SessionReader } from "eve/sessions";

// Eve sends tool arguments on its browser stream, including incremental JSON
// before the tool runs. A resumed stream may start halfway through an argument.
export function hideDrawingInputs(
  response: Response,
  history?: {
    startIndex: number;
    read: () => ReturnType<SessionReader["stream"]>;
  },
): Response {
  if (
    !response.body ||
    !response.headers.get("content-type")?.startsWith("application/x-ndjson")
  )
    return response;
  const names = new Map<string, string>();
  async function isPublicCall(id: string) {
    if (!names.has(id) && history) {
      // A reconnect can start with an unnamed delta or settlement. Read the
      // authorized session's recorded names once, only if we need one.
      const recorded = history;
      history = undefined;
      try {
        const pending = new Map<string, string>();
        for await (const event of recorded.read()) {
          if (event.meta.position.line >= recorded.startIndex) break;
          if (event.type === "call.requested") {
            pending.set(event.data.callId, event.data.capability.name);
          } else if (event.type === "call.input" && event.data.name) {
            pending.set(event.data.callId, event.data.name);
          } else if (event.type === "call.settled") {
            pending.delete(event.data.callId);
          }
        }
        for (const [id, name] of pending) {
          if (!names.has(id)) names.set(id, name);
        }
      } catch {
        // A call we could not identify stays private.
      }
    }
    return names.has(id) && names.get(id) !== "draw_svg";
  }

  async function redact(line: string) {
    const record = JSON.parse(line);
    const progress = record.progress;
    if (progress?.type === "call.input") {
      const data = progress.data;
      if (data.name) names.set(data.callId, data.name);
      if (!(await isPublicCall(data.callId))) data.delta = "";
    }
    for (const fact of record.facts ?? []) {
      if (fact.type === "call.requested") {
        const data = fact.data;
        names.set(data.callId, data.capability.name);
        if (data.capability.name === "draw_svg") {
          delete data.input;
          delete data.inputRef;
          delete data.inputError;
        }
      }
      if (fact.type === "call.settled") {
        if (
          fact.data.outcome === "failed" &&
          !(await isPublicCall(fact.data.callId))
        ) {
          delete fact.data.output;
          delete fact.data.outputRef;
          fact.data.error = {
            code: "tool_error",
            message: "The tool call failed.",
          };
        }
        names.delete(fact.data.callId);
      }
    }
    return JSON.stringify(record) + "\n";
  }
  let remainder = "";
  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        async transform(chunk, controller) {
          const lines = (remainder + chunk).split("\n");
          remainder = lines.pop()!;
          for (const line of lines)
            if (line) controller.enqueue(await redact(line));
        },
        async flush(controller) {
          if (remainder) controller.enqueue(await redact(remainder));
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  return new Response(body, response);
}
