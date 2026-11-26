import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import {
  groupsOf,
  type InputData,
  InputSchema,
  SchemaForm,
} from "../../shell/SchemaForm.tsx";
import type { ViewContext } from "../../shell/Shell.tsx";
import { t } from "../../shell/text.ts";

/** `jobs_input_request`'s result: the agent's schema arrives as JSON text. */
const Request = z.object({
  data: z.object({
    eventId: z.string(),
    message: z.string().nullish(),
    inputSchema: z.string(),
  }),
});
const Refusal = z.object({ message: z.string() });

interface Question {
  eventId: string;
  message?: string | null;
  schema: InputSchema;
}

type Step =
  | { kind: "loading" }
  | { kind: "elsewhere" }
  | { kind: "form"; question: Question; error?: string }
  | { kind: "sending"; question: Question };

/**
 * The schema as Masumi's `normalizeAndValidateInputSchema` reads it: an
 * object, or a bare list of groups or of fields. A schema without fields
 * has nothing to answer here.
 */
export function parseInputSchema(text: string): InputSchema | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const shapes = Array.isArray(parsed)
    ? [{ input_groups: parsed }, { input_data: parsed }]
    : [parsed];
  for (const shape of shapes) {
    const schema = InputSchema.safeParse(shape).data;
    if (!schema) continue;
    return groupsOf(schema).some(({ fields }) => fields.length > 0)
      ? schema
      : undefined;
  }
  return undefined;
}

/**
 * The question a Job waits on, as a form. It loads with `jobs_input_request`
 * and answers with `jobs_input` and the request's `eventId`. Answering spends
 * nothing, so the submit is the only confirm. Polling goes on while the
 * person types, so an answer given elsewhere still shows; `onPause` holds it
 * only while the answer is in flight.
 */
export function InputRequest({
  jobId,
  context,
  onPause,
  onSent,
  onUpload,
}: {
  jobId: string;
  context: ViewContext;
  onPause: (paused: boolean) => void;
  onSent: (eventId: string) => void;
  onUpload?: () => void;
}) {
  const { app, input = {} } = context;
  const workspace =
    typeof input.workspace === "string" && input.workspace
      ? input.workspace
      : undefined;
  const scope = workspace ? { workspace } : {};
  // Without the call's arguments the workspace is unknown: wait for them.
  const canCall = !!app.getHostCapabilities()?.serverTools && !!context.input;
  const [step, setStep] = useState<Step>(
    canCall ? { kind: "loading" } : { kind: "elsewhere" },
  );
  // Set before the call leaves, so a second click in the same frame is a no-op.
  const sending = useRef(false);
  const headingId = useId();

  const warn = (what: string) => (error: unknown) =>
    app
      .sendLog({ level: "warning", data: `${what} failed: ${String(error)}` })
      .catch(() => {});

  const paused = step.kind === "sending";
  useEffect(() => {
    onPause(paused);
    return () => onPause(false);
  }, [paused]);

  useEffect(() => {
    if (!canCall) return;
    let stopped = false;
    app
      .callServerTool({
        name: "jobs_input_request",
        arguments: { id: jobId, ...scope },
      })
      .then(
        (result) => {
          const request = result.isError
            ? undefined
            : Request.safeParse(result.structuredContent).data?.data;
          const schema = request && parseInputSchema(request.inputSchema);
          if (stopped) return;
          setStep(
            request && schema
              ? {
                  kind: "form",
                  question: {
                    eventId: request.eventId,
                    message: request.message,
                    schema,
                  },
                }
              : { kind: "elsewhere" },
          );
        },
        (error: unknown) => {
          warn("jobs_input_request")(error);
          if (!stopped) setStep({ kind: "elsewhere" });
        },
      );
    return () => {
      stopped = true;
    };
  }, []);

  const send = async (question: Question, inputData: InputData) => {
    if (sending.current) return;
    sending.current = true;
    setStep({ kind: "sending", question });
    try {
      const result = await app.callServerTool({
        name: "jobs_input",
        arguments: {
          id: jobId,
          ...scope,
          body: { eventId: question.eventId, inputData },
        },
      });
      if (!result.isError) {
        onSent(question.eventId);
        return;
      }
      setStep({
        kind: "form",
        question,
        error:
          Refusal.safeParse(result.structuredContent).data?.message ??
          t("jobStatus.input.failed"),
      });
    } catch (error) {
      // Safe to try again: Core refuses a second answer to the same event.
      warn("jobs_input")(error);
      setStep({ kind: "form", question, error: t("jobStatus.input.failed") });
    }
    sending.current = false;
  };

  if (step.kind === "loading" || step.kind === "elsewhere") {
    return (
      <p
        data-step={`input-${step.kind}`}
        className="text-muted-foreground text-sm"
      >
        {step.kind === "loading"
          ? t("jobStatus.input.loading")
          : t("jobStatus.input.elsewhere")}
      </p>
    );
  }

  const { question } = step;
  const busy = step.kind === "sending";
  const error = step.kind === "form" ? step.error : undefined;
  return (
    <section
      aria-labelledby={question.message ? headingId : undefined}
      data-step={busy ? "input-sending" : error ? "input-failed" : "input"}
      className="flex flex-col gap-4"
    >
      {question.message && (
        <div className="flex flex-col gap-2">
          <h2
            id={headingId}
            className="text-muted-foreground text-xs font-medium"
          >
            {t("jobStatus.input.question")}
          </h2>
          <p className="text-sm break-words whitespace-pre-wrap">
            {question.message}
          </p>
        </div>
      )}
      <SchemaForm
        schema={question.schema}
        submitLabel={
          busy ? t("jobStatus.input.sending") : t("jobStatus.input.send")
        }
        disabled={busy}
        onUpload={onUpload}
        onSubmit={(inputData) => send(question, inputData)}
        footer={
          <p role="alert" className="text-destructive text-sm empty:hidden">
            {error ?? ""}
          </p>
        }
      />
    </section>
  );
}
