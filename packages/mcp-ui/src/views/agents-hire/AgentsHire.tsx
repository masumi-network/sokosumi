import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  type InputData,
  InputSchema,
  SchemaForm,
} from "../../shell/SchemaForm.tsx";
import type { ViewContext } from "../../shell/Shell.tsx";
import {
  formatNumber,
  isPlainReference,
  isUnderBase,
  t,
} from "../../shell/text.ts";
import { Message, PrimaryButton, QuietButton } from "../../shell/ui.tsx";

/** `agents_input_schema`'s result, which `agents_show_hire` returns unchanged. */
export const HireResult = z.object({ data: InputSchema });
export type HireResult = z.infer<typeof HireResult>;

const Agent = z.object({
  data: z.object({ name: z.string(), credits: z.number() }),
});
const Balance = z.object({ data: z.object({ spendable: z.number() }) });
const Job = z.object({ data: z.object({ id: z.string() }) });
const Refusal = z.object({ message: z.string() });

/**
 * The cap for a free agent's hire: Core's smallest credit unit (10^-10 credit,
 * one billing cent). Core rejects `maxCredits: 0` (`createJobRequestSchema`
 * has `.positive()`, and `createAgentJobForUser` reads 0 as "no cap"), so a
 * free hire sends this instead, and a price that appeared after the confirm
 * fails with "Credit cost exceeds maximum accepted credits".
 */
const SMALLEST_CREDIT = 1e-10;

/** What the confirm step shows: Core's answers, fetched by the view. */
interface Quote {
  name: string;
  price: number;
  balance?: number;
}

type Step =
  | { kind: "form"; notice?: string }
  | { kind: "checking" }
  | { kind: "confirm"; quote: Quote }
  | { kind: "hiring"; quote: Quote }
  | { kind: "hired"; quote: Quote; jobId: string }
  | { kind: "refused"; message?: string }
  | { kind: "unknown" };

function parsed<T>(
  schema: z.ZodType<T>,
  result: CallToolResult,
): T | undefined {
  if (result.isError) return undefined;
  return schema.safeParse(result.structuredContent).data;
}

export function AgentsHire({
  data,
  context,
}: {
  data: HireResult;
  context: ViewContext;
}) {
  const { app, input = {}, locale } = context;
  const agentId = typeof input.id === "string" ? input.id : undefined;
  const workspace =
    typeof input.workspace === "string" && input.workspace
      ? input.workspace
      : undefined;
  const scope = workspace ? { workspace } : {};
  const canCall = !!app.getHostCapabilities()?.serverTools && !!agentId;

  const [step, setStep] = useState<Step>({ kind: "form" });
  const [answers, setAnswers] = useState<InputData>({});
  const [agentName, setAgentName] = useState<string>();
  // Set before the call leaves, so a second click in the same frame is a no-op.
  const hiring = useRef(false);

  const warn = (what: string) => (error: unknown) =>
    app
      .sendLog({ level: "warning", data: `${what} failed: ${String(error)}` })
      .catch(() => {});
  const call = (name: string, args: Record<string, unknown>) =>
    app.callServerTool({ name, arguments: args });

  const quote = async (): Promise<Quote | undefined> => {
    const [agent, balance] = await Promise.all([
      call("agents_get", { id: agentId, ...scope }).then(
        (result) => parsed(Agent, result),
        () => undefined,
      ),
      // Unknown when the workspaces toolset is off: Core refuses the call.
      call("workspaces_credits", { id: "me", ...scope }).then(
        (result) => parsed(Balance, result),
        () => undefined,
      ),
    ]);
    if (!agent) return undefined;
    setAgentName(agent.data.name);
    return {
      name: agent.data.name,
      price: agent.data.credits,
      balance: balance?.data.spendable,
    };
  };

  // The name for the title; the price is fetched again at review.
  useEffect(() => {
    if (canCall) void quote();
  }, []);

  const review = async (values: InputData) => {
    setAnswers(values);
    setStep({ kind: "checking" });
    const next = await quote();
    setStep(
      next
        ? { kind: "confirm", quote: next }
        : { kind: "form", notice: t("agentsHire.quoteFailed") },
    );
  };

  const hire = async (current: Quote) => {
    if (hiring.current) return;
    hiring.current = true;
    setStep({ kind: "hiring", quote: current });
    try {
      const result = await call("agents_hire", {
        id: agentId,
        ...scope,
        body: {
          inputSchema: data.data,
          inputData: answers,
          // The shown price caps the charge: a higher price fails instead.
          maxCredits: current.price > 0 ? current.price : SMALLEST_CREDIT,
        },
      });
      const job = parsed(Job, result);
      if (job) {
        setStep({ kind: "hired", quote: current, jobId: job.data.id });
        return;
      }
      if (!result.isError) {
        // Core answered without a Job we can read: it may have started one.
        setStep({ kind: "unknown" });
        return;
      }
      hiring.current = false;
      setStep({
        kind: "refused",
        message: Refusal.safeParse(result.structuredContent).data?.message,
      });
    } catch (error) {
      // The call may have reached Core: never offer a second hire.
      warn("agents_hire")(error);
      setStep({ kind: "unknown" });
    }
  };

  const agentUrl = () => {
    const base = context.webBaseUrl;
    if (!base || !agentId) return undefined;
    const url = `${base.replace(/\/$/, "")}/agents/${encodeURIComponent(agentId)}`;
    return isUnderBase(url, base) ? url : undefined;
  };
  const upload = agentUrl();

  const credits = (amount: number) =>
    t(amount === 1 ? "agentsHire.credit" : "agentsHire.credits", {
      amount: formatNumber(amount, locale),
    });
  const workspaceName = workspace ?? t("agentsHire.personal");

  if (!agentId) {
    return (
      <Message title={t("shell.error.title")} body={t("shell.error.body")} />
    );
  }
  if (!canCall) {
    return (
      <AskToHire context={context} agentId={agentId} workspace={workspace} />
    );
  }

  const title = (
    <h1 className="text-base font-semibold tracking-tight">
      {agentName
        ? t("agentsHire.title", { name: agentName })
        : t("agentsHire.titleUnknown")}
    </h1>
  );

  if (step.kind === "form" || step.kind === "checking") {
    return (
      <article data-step={step.kind} className="flex flex-col gap-5">
        <header className="flex flex-col gap-0.5">
          {title}
          <p className="text-muted-foreground text-xs">{workspaceName}</p>
        </header>
        <SchemaForm
          schema={data.data}
          initial={answers}
          submitLabel={
            step.kind === "checking"
              ? t("agentsHire.checking")
              : t("agentsHire.review")
          }
          disabled={step.kind === "checking"}
          onUpload={
            upload
              ? () => app.openLink({ url: upload }).catch(warn("ui/open-link"))
              : undefined
          }
          onSubmit={review}
          footer={
            <p role="status" className="text-destructive text-sm empty:hidden">
              {step.kind === "form" ? (step.notice ?? "") : ""}
            </p>
          }
        />
      </article>
    );
  }

  if (step.kind === "refused" || step.kind === "unknown") {
    return (
      <article data-step={step.kind} className="flex flex-col gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          {t("agentsHire.failed")}
        </h1>
        {step.kind === "unknown" ? (
          <p className="text-muted-foreground text-sm">
            {t("agentsHire.unknown")}
          </p>
        ) : (
          <>
            {step.message && (
              <p className="text-muted-foreground text-sm">{step.message}</p>
            )}
            <QuietButton
              onClick={() => setStep({ kind: "form" })}
              className="border-border w-full border sm:w-auto sm:self-start"
            >
              {t("agentsHire.back")}
            </QuietButton>
          </>
        )}
      </article>
    );
  }

  if (step.kind === "hired") {
    const { jobId } = step;
    const showStatus = () =>
      app
        .sendMessage({
          role: "user",
          content: [
            { type: "text", text: t("agentsHire.statusMessage", { jobId }) },
          ],
        })
        .catch(warn("ui/message"));
    return (
      <article data-step="hired" className="flex flex-col gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          {t("agentsHire.hired", { name: step.quote.name })}
        </h1>
        <dl className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">
            {t("agentsHire.job")}
          </dt>
          <dd className="font-mono text-sm break-all">{jobId}</dd>
        </dl>
        {isPlainReference(jobId) && (
          <QuietButton
            onClick={showStatus}
            className="border-border w-full border sm:w-auto sm:self-start"
          >
            {t("agentsHire.showStatus")}
          </QuietButton>
        )}
      </article>
    );
  }

  // confirm and hiring
  const current = step.quote;
  const short =
    current.balance !== undefined && current.balance < current.price;
  const busy = step.kind === "hiring";
  return (
    <article data-step={step.kind} className="flex flex-col gap-5">
      <h1 className="text-base font-semibold tracking-tight">
        {t("agentsHire.confirmTitle")}
      </h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-muted-foreground">{t("agentsHire.agent")}</dt>
        <dd className="min-w-0 break-words">{current.name}</dd>
        <dt className="text-muted-foreground">{t("agentsHire.workspace")}</dt>
        <dd className="min-w-0 break-words">{workspaceName}</dd>
        <dt className="text-muted-foreground">{t("agentsHire.price")}</dt>
        <dd className="font-medium tabular-nums">
          {current.price > 0 ? credits(current.price) : t("agentsHire.free")}
        </dd>
        {current.balance !== undefined && (
          <>
            <dt className="text-muted-foreground">{t("agentsHire.balance")}</dt>
            <dd className="tabular-nums">{credits(current.balance)}</dd>
          </>
        )}
      </dl>
      {short && (
        <p className="text-destructive text-sm">{t("agentsHire.short")}</p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <QuietButton
          onClick={() => setStep({ kind: "form" })}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          {t("agentsHire.edit")}
        </QuietButton>
        <PrimaryButton
          onClick={() => hire(current)}
          disabled={busy || short}
          aria-busy={busy}
        >
          {busy ? t("agentsHire.hiring") : t("agentsHire.hire")}
        </PrimaryButton>
      </div>
    </article>
  );
}

/**
 * Hosts that cannot proxy a view's tool calls: ask in the conversation with a
 * fixed message naming only ids, so the host's own prompt guards the hire.
 */
function AskToHire({
  context,
  agentId,
  workspace,
}: {
  context: ViewContext;
  agentId?: string;
  workspace?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const safe =
    isPlainReference(agentId) &&
    (workspace === undefined || isPlainReference(workspace));
  const ask = async () => {
    if (!safe || state === "sending" || state === "sent") return;
    setState("sending");
    const text = workspace
      ? t("agentsHire.ask", { agent: agentId, workspace })
      : t("agentsHire.askPersonal", { agent: agentId });
    try {
      const result = await context.app.sendMessage({
        role: "user",
        content: [{ type: "text", text }],
      });
      setState(result.isError ? "failed" : "sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <article data-step="ask" className="flex flex-col gap-3">
      <h1 className="text-base font-semibold tracking-tight">
        {t("agentsHire.titleUnknown")}
      </h1>
      <p className="text-muted-foreground text-sm">{t("agentsHire.askBody")}</p>
      {safe && state !== "sent" && (
        <PrimaryButton
          onClick={ask}
          disabled={state === "sending"}
          className="sm:self-start"
        >
          {t("agentsHire.askButton")}
        </PrimaryButton>
      )}
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {state === "sent"
          ? t("agentsHire.asked")
          : state === "failed"
            ? t("agentsHire.askFailed")
            : ""}
      </p>
    </article>
  );
}
