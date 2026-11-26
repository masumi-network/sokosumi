import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";

/**
 * Local only: OpenAI models run on the developer's own ChatGPT plan ("Sign in
 * with ChatGPT" plan usage) instead of the AI Gateway, for quick local eval
 * and dev runs. Each developer signs in with their own account:
 * `pnpm chatgpt-plan:login` (also `:status`, `:logout`).
 * Runs that decide defaults stay on the Gateway: the plan has no prompt cache
 * retention, no output cap and no cost.
 */

export const CHATGPT_PLAN_AUTH_URL = "https://auth.openai.com/api/accounts";
export const CHATGPT_PLAN_API_URL = "https://api.openai.com/v1";

/** Per machine and outside every checkout, so it can never be committed. */
export const CHATGPT_PLAN_SESSION_FILE = join(
  homedir(),
  ".sokosumi",
  "chatgpt-plan.json",
);

export type ChatGptPlanSession = {
  hostId: string;
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
};

/** Request fields the plan's Responses API refuses (preview limitations). */
const UNSUPPORTED_FIELDS = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "prompt",
  "prompt_cache_key",
  "prompt_cache_options",
  "prompt_cache_retention",
  "previous_response_id",
  "safety_identifier",
  "service_tier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

export function localChatGptPlanEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.SOKO_BOT_LOCAL_CHATGPT_PLAN;
  if (flag !== "1" && flag !== "true") return false;
  if (env.VERCEL || env.NODE_ENV === "production")
    throw new Error(
      "SOKO_BOT_LOCAL_CHATGPT_PLAN is local only; unset it on deployments.",
    );
  return true;
}

/**
 * The plan model that stands in for every non-OpenAI model (Gemini and Claude
 * checks, Jev) on a plan run, so nothing reaches the paid Gateway. Their
 * answers are approximate: a different model than production uses.
 */
export const CHATGPT_PLAN_STANDIN_MODEL = "openai/gpt-6-luna";

const GATEWAY_HOST = "ai-gateway.vercel.sh";

/** A plan run tried to call the paid AI Gateway; nothing was sent. */
export class ChatGptPlanGatewayCallError extends Error {
  constructor(path: string) {
    super(
      `A ChatGPT plan run tried to call the AI Gateway (${path}); nothing was sent. Route this call through the plan or skip it on plan runs.`,
    );
    this.name = "ChatGptPlanGatewayCallError";
  }
}

let gatewayGuarded = false;

/**
 * Plan runs must spend nothing on the Gateway: every request to it fails
 * before it leaves the process, whatever code path made it.
 */
export function installChatGptPlanGatewayGuard(): void {
  if (gatewayGuarded || !localChatGptPlanEnabled()) return;
  gatewayGuarded = true;
  const send = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.hostname === GATEWAY_HOST)
      return Promise.reject(new ChatGptPlanGatewayCallError(url.pathname));
    return send(input, init);
  };
}

/**
 * The plan model for a Gateway id, or null to keep the Gateway (plan off).
 * `openai/<slug>` runs as `<slug>`; any other model runs as the stand-in.
 */
export function localChatGptPlanModel(
  model: string,
): ReturnType<typeof wrapLanguageModel> | null {
  if (!localChatGptPlanEnabled()) return null;
  const planModel = model.startsWith("openai/")
    ? model
    : CHATGPT_PLAN_STANDIN_MODEL;
  const provider = createOpenAI({
    apiKey: "chatgpt-plan",
    baseURL: CHATGPT_PLAN_API_URL,
    fetch: chatGptPlanFetch,
  });
  return wrapLanguageModel({
    model: provider.responses(planModel.slice("openai/".length)),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            // Unset, the plan reasons less than the API: Cuso turns ran a
            // third shorter and skipped work the Gateway did (2026-11-25).
            reasoningEffort: "medium",
            ...params.providerOptions?.openai,
            store: false,
            forceReasoning: true,
          },
        },
      }),
      async wrapStream({ doStream }) {
        const { stream, ...rest } = await doStream();
        return {
          ...rest,
          stream: stream.pipeThrough(
            new TransformStream({
              transform(part, controller) {
                controller.enqueue(
                  part.type === "error" &&
                    JSON.stringify(part.error ?? "").includes(USAGE_LIMIT_CODE)
                    ? { type: "error", error: new ChatGptPlanLimitError() }
                    : part,
                );
              },
            }),
          ),
        };
      },
    },
  });
}

export async function readChatGptPlanSession(): Promise<ChatGptPlanSession | null> {
  try {
    return JSON.parse(
      await readFile(CHATGPT_PLAN_SESSION_FILE, "utf8"),
    ) as ChatGptPlanSession;
  } catch {
    return null;
  }
}

export async function deleteChatGptPlanTokens(
  session: ChatGptPlanSession,
): Promise<void> {
  await writeChatGptPlanSession({ hostId: session.hostId });
}

export async function writeChatGptPlanSession(
  session: ChatGptPlanSession,
): Promise<void> {
  await mkdir(dirname(CHATGPT_PLAN_SESSION_FILE), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(CHATGPT_PLAN_SESSION_FILE, JSON.stringify(session), {
    mode: 0o600,
  });
  await chmod(CHATGPT_PLAN_SESSION_FILE, 0o600);
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
};

/** Store a token response; the refresh token rotates, so all fields move together. */
export async function saveChatGptPlanTokens(
  session: ChatGptPlanSession,
  tokens: TokenResponse,
): Promise<ChatGptPlanSession> {
  const next: ChatGptPlanSession = {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    idToken: tokens.id_token ?? session.idToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await writeChatGptPlanSession(next);
  return next;
}

export async function requestChatGptPlanTokens(
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(`${CHATGPT_PLAN_AUTH_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, resource: CHATGPT_PLAN_API_URL }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      `ChatGPT plan token request failed (${response.status} ${error.error ?? ""}). Sign in again: pnpm chatgpt-plan:login`,
    );
  }
  return (await response.json()) as TokenResponse;
}

const USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";

let refreshing: Promise<string> | null = null;

/** A valid access token; refreshes are serialized because the refresh token rotates. */
export async function chatGptPlanAccessToken(): Promise<string> {
  const session = await readChatGptPlanSession();
  if (!session?.clientId || !session.refreshToken)
    throw new Error(
      "Not signed in to a ChatGPT plan on this machine. Run: pnpm chatgpt-plan:login",
    );
  if (session.accessToken && (session.expiresAt ?? 0) > Date.now() + 60_000)
    return session.accessToken;
  refreshing ??= refreshAccessToken(session).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshAccessToken(
  session: ChatGptPlanSession,
): Promise<string> {
  const tokens = await requestChatGptPlanTokens({
    grant_type: "refresh_token",
    client_id: session.clientId ?? "",
    refresh_token: session.refreshToken ?? "",
  });
  return (await saveChatGptPlanTokens(session, tokens)).accessToken ?? "";
}

/** The Responses body the plan accepts: stateless, streamed, no refused fields. */
export function chatGptPlanRequestBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body, store: false, stream: true };
  for (const field of UNSUPPORTED_FIELDS) delete next[field];
  if (Array.isArray(next.input))
    next.input = next.input.map((item: Record<string, unknown>) =>
      item?.role === "system" ? { ...item, role: "developer" } : item,
    );
  return next;
}

/**
 * The plan only streams. A non-streaming SDK call gets the final response
 * object from `response.completed`, which has the shape of a plain response.
 */
export async function chatGptPlanFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${await chatGptPlanAccessToken()}`);
  if (!url.endsWith("/responses") || typeof init?.body !== "string")
    return fetch(input, { ...init, headers });

  const original = JSON.parse(init.body) as Record<string, unknown>;
  const response = await fetch(url, {
    ...init,
    headers,
    body: JSON.stringify(chatGptPlanRequestBody(original)),
  });
  if (response.status === 429) throw new ChatGptPlanLimitError();
  if (original.stream === true || !response.ok || !response.body)
    return response;
  return collectStreamedResponse(response);
}

/** The plan's usage limit. Never falls back to the paid Gateway: wait instead. */
export class ChatGptPlanLimitError extends Error {
  constructor() {
    super(
      "ChatGPT plan usage limit reached. Wait for it to reset (ChatGPT settings, Usage) and run again; nothing was sent to the AI Gateway instead.",
    );
    this.name = "ChatGptPlanLimitError";
  }
}

async function collectStreamedResponse(response: Response): Promise<Response> {
  const text = await response.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = JSON.parse(line.slice(5).trim()) as {
      type?: string;
      response?: { error?: { code?: string } };
    };
    if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    )
      return Response.json(event.response);
    if (event.type === "response.failed") {
      if (event.response?.error?.code === USAGE_LIMIT_CODE)
        throw new ChatGptPlanLimitError();
      return Response.json(event.response, { status: 500 });
    }
  }
  return Response.json(
    { error: { message: "ChatGPT plan stream ended without a response" } },
    { status: 502 },
  );
}
