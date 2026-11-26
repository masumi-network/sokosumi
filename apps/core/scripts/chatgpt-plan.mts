/**
 * Your own ChatGPT plan for local evals and dev runs (see
 * `src/lib/local-chatgpt-plan.ts`). Each developer signs in with their own
 * account; the session stays on this machine in ~/.sokosumi/chatgpt-plan.json
 * (0600). Tokens are never printed.
 *
 *   pnpm chatgpt-plan:login    # opens the browser: sign in and approve
 *   pnpm chatgpt-plan:status   # who is signed in, which models the plan has
 *   pnpm chatgpt-plan:logout   # revokes the session and forgets it
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { platform } from "node:os";
import {
  CHATGPT_PLAN_API_URL,
  CHATGPT_PLAN_AUTH_URL,
  CHATGPT_PLAN_SESSION_FILE,
  type ChatGptPlanSession,
  chatGptPlanAccessToken,
  deleteChatGptPlanTokens,
  readChatGptPlanSession,
  requestChatGptPlanTokens,
  saveChatGptPlanTokens,
  writeChatGptPlanSession,
} from "../src/lib/local-chatgpt-plan";

const PORT = 1455;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/auth/callback`;
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const base64url = (bytes: Buffer) => bytes.toString("base64url");

function openBrowser(url: string): void {
  const command =
    platform() === "darwin"
      ? "open"
      : platform() === "win32"
        ? "explorer"
        : "xdg-open";
  execFile(command, [url], () => {});
}

async function login(): Promise<void> {
  const stored = await readChatGptPlanSession();
  const session: ChatGptPlanSession = stored ?? {
    hostId: `urn:uuid:${randomUUID()}`,
  };
  if (!stored) await writeChatGptPlanSession(session);

  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: session.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: session.hostId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    resource: CHATGPT_PLAN_API_URL,
    state,
    nonce: base64url(randomBytes(16)),
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  if (!session.clientId) params.set("agent_name_hint", "Sokosumi local evals");
  const authorizeUrl = `${CHATGPT_PLAN_AUTH_URL}/authorize?${params}`;

  const callback = await new Promise<URLSearchParams>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, { "content-type": "text/plain" })
        .end("Done. You can close this tab.");
      server.close();
      resolve(url.searchParams);
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(
        `Sign in with your own ChatGPT account and approve:\n\n${authorizeUrl}\n`,
      );
      openBrowser(authorizeUrl);
    });
  });

  if (callback.get("state") !== state) throw new Error("State mismatch");
  if (callback.get("error"))
    throw new Error(`Sign-in refused: ${callback.get("error")}`);
  const clientId = callback.get("client_id") ?? session.clientId;
  const code = callback.get("code");
  if (!clientId || !code)
    throw new Error("Callback had no code or issued client_id");

  const tokens = await requestChatGptPlanTokens({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });
  if (!tokens.scope?.split(" ").includes("chatgpt.tokens.use.direct"))
    throw new Error(
      "Plan usage was not granted (no chatgpt.tokens.use.direct scope)",
    );
  await saveChatGptPlanTokens({ ...session, clientId }, tokens);
  console.log(`Signed in. Session saved to ${CHATGPT_PLAN_SESSION_FILE}`);
  await status();
}

async function status(): Promise<void> {
  const session = await readChatGptPlanSession();
  if (!session?.refreshToken) {
    console.log("Not signed in. Run: pnpm chatgpt-plan:login");
    process.exitCode = 1;
    return;
  }
  const token = await chatGptPlanAccessToken();
  const response = await fetch(`${CHATGPT_PLAN_API_URL}/models`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(
      `Model list failed (${response.status}). Sign in again: pnpm chatgpt-plan:login`,
    );
  type Model = {
    slug?: string;
    id?: string;
    display_name?: string;
    visibility?: string;
  };
  const body = (await response.json()) as { models?: Model[]; data?: Model[] };
  const { email } = await idTokenClaims(session);
  console.log(`Signed in${email ? ` as ${email}` : ""}.`);
  console.log("Models on the plan (Gateway id openai/<slug> runs on it):");
  for (const model of body.models ?? body.data ?? [])
    if (!model.visibility || model.visibility === "list")
      console.log(`  ${model.slug ?? model.id}  ${model.display_name ?? ""}`);
}

async function idTokenClaims(
  session: ChatGptPlanSession,
): Promise<{ email?: string }> {
  const payload = session.idToken?.split(".")[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function logout(): Promise<void> {
  const session = await readChatGptPlanSession();
  if (!session?.refreshToken || !session.clientId) {
    console.log("Not signed in.");
    return;
  }
  const discovery = (await (
    await fetch("https://auth.openai.com/.well-known/openid-configuration")
  ).json()) as { revocation_endpoint?: string };
  if (discovery.revocation_endpoint)
    await fetch(discovery.revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: session.refreshToken,
        token_type_hint: "refresh_token",
        client_id: session.clientId,
      }),
    });
  await deleteChatGptPlanTokens(session);
  console.log("Signed out; the session is revoked and removed.");
}

const commands = { login, status, logout } as const;
const name = process.argv[2] as keyof typeof commands;
if (!commands[name]) {
  console.error("Usage: chatgpt-plan login | status | logout");
  process.exit(1);
}
await commands[name]();
