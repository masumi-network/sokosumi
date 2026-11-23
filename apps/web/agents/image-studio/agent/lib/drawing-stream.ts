// Eve sends tool arguments on its browser stream, including incremental JSON
// before the tool runs. A resumed stream may start halfway through an argument.
export function hideDrawingInputs(response: Response): Response {
  if (
    !response.body ||
    !response.headers.get("content-type")?.startsWith("application/x-ndjson")
  )
    return response;
  const publicCalls = new Set<string>();
  function redact(line: string) {
    const record = JSON.parse(line);
    const progress = record.progress;
    if (progress?.type === "call.input") {
      const data = progress.data;
      if (data.name && data.name !== "draw_svg") publicCalls.add(data.callId);
      if (!publicCalls.has(data.callId)) data.delta = "";
    }
    for (const fact of record.facts ?? []) {
      if (fact.type === "call.requested") {
        const data = fact.data;
        if (data.capability.name === "draw_svg") {
          delete data.input;
          delete data.inputRef;
          delete data.inputError;
        } else publicCalls.add(data.callId);
      }
      if (fact.type === "call.settled") {
        if (
          !publicCalls.has(fact.data.callId) &&
          fact.data.outcome === "failed"
        ) {
          delete fact.data.output;
          delete fact.data.outputRef;
          fact.data.error = {
            code: "tool_error",
            message: "The tool call failed.",
          };
        }
        publicCalls.delete(fact.data.callId);
      }
    }
    return JSON.stringify(record) + "\n";
  }
  let remainder = "";
  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          const lines = (remainder + chunk).split("\n");
          remainder = lines.pop()!;
          for (const line of lines) if (line) controller.enqueue(redact(line));
        },
        flush(controller) {
          if (remainder) controller.enqueue(redact(remainder));
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  return new Response(body, response);
}
