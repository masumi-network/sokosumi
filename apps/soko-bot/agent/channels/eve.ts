import { isSokoBotCapability } from "@sokosumi/soko-bot";
import type { AuthFn } from "eve/channels/auth";
import { UnauthenticatedError } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { importSPKI, type JWTPayload, jwtVerify } from "jose";

import {
  evaluationCapabilities,
  evaluationScenario,
  isLocalEvaluationEnvironment,
} from "../lib/evaluation";

interface PublicKeyConfig {
  keyId: string;
  publicKeyPem: string;
}

interface SokoClaims extends JWTPayload {
  tokenUse?: unknown;
  userId?: unknown;
  sokoBotId?: unknown;
  workspaceId?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  capabilities?: unknown;
}

let publicKeysPromise: Promise<Map<string, CryptoKey>> | undefined;

function requiredClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new UnauthenticatedError({ message: `Invalid ${name} claim` });
  }
  return value;
}

async function publicKeys(): Promise<Map<string, CryptoKey>> {
  if (publicKeysPromise) return publicKeysPromise;
  publicKeysPromise = (async () => {
    const raw = process.env.SOKO_BOT_SIGNING_PUBLIC_KEYS;
    if (!raw) throw new Error("SOKO_BOT_SIGNING_PUBLIC_KEYS is required");
    const parsed = JSON.parse(raw) as PublicKeyConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("At least one Soko Bot signing public key is required");
    }
    const entries = await Promise.all(
      parsed.map(
        async (key) =>
          [
            key.keyId,
            await importSPKI(key.publicKeyPem.replaceAll("\\n", "\n"), "EdDSA"),
          ] as const,
      ),
    );
    return new Map(entries);
  })();
  return publicKeysPromise;
}

async function verify(token: string, audience: string): Promise<SokoClaims> {
  const issuer = process.env.SOKO_BOT_TOKEN_ISSUER?.trim();
  if (!issuer) throw new Error("SOKO_BOT_TOKEN_ISSUER is required");
  const keys = await publicKeys();
  const result = await jwtVerify<SokoClaims>(
    token,
    async (header) => {
      const key = header.kid ? keys.get(header.kid) : undefined;
      if (!key)
        throw new UnauthenticatedError({ message: "Unknown signing key" });
      return key;
    },
    { algorithms: ["EdDSA"], issuer, audience, clockTolerance: 5 },
  );
  return result.payload;
}

function bearer(request: Request): string {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1])
    throw new UnauthenticatedError({ message: "Missing request token" });
  return match[1];
}

function requiresTurnGrant(pathname: string, method: string): boolean {
  if (method !== "POST") return false;
  return (
    pathname === "/eve/v1/session" ||
    /^\/eve\/v1\/session\/[^/]+$/.test(pathname)
  );
}

const sokoBotAuth: AuthFn<Request> = async (request) => {
  try {
    const url = new URL(request.url);
    if (
      isLocalEvaluationEnvironment() &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    ) {
      const requestText =
        request.method === "POST" ? await request.clone().text() : "";
      const scenario = evaluationScenario(requestText);
      return {
        attributes: {
          userId: "eval-user",
          sokoBotId: "eval-soko-bot",
          workspaceId: "eval-workspace",
          sessionIdClaim:
            url.pathname.match(/^\/eve\/v1\/session\/([^/]+)/)?.[1] ??
            "eval-session",
          turnId: `eval:${scenario}`,
          turnGrant: "eval-turn-grant",
          capabilities: JSON.stringify(evaluationCapabilities(scenario)),
          model: "",
          versionId: "",
          inferenceRegion: "",
        },
        authenticator: "soko-bot:eval",
        issuer: "eve-eval",
        principalId: "eval-user",
        principalType: "user",
        subject: "eval-user",
      };
    }
    const claims = await verify(bearer(request), "soko-bot-runtime");
    if (claims.tokenUse !== "soko_bot_request") {
      throw new UnauthenticatedError({ message: "Invalid request token use" });
    }
    const userId = requiredClaim(claims.userId, "userId");
    const sokoBotId = requiredClaim(claims.sokoBotId, "sokoBotId");
    const workspaceId = requiredClaim(claims.workspaceId, "workspaceId");
    const sessionIdClaim = requiredClaim(claims.sessionId, "sessionId");
    const turnId = requiredClaim(claims.turnId, "turnId");
    const pathSession = url.pathname.match(/^\/eve\/v1\/session\/([^/]+)/)?.[1];
    if (pathSession && !["stream", "cancel", "reset"].includes(pathSession)) {
      const decoded = decodeURIComponent(pathSession);
      if (sessionIdClaim !== decoded) {
        throw new UnauthenticatedError({ message: "Request session mismatch" });
      }
    }

    const turnGrant = request.headers.get("x-soko-bot-turn-grant") ?? "";
    let capabilities: string[] = [];
    if (requiresTurnGrant(url.pathname, request.method)) {
      if (!turnGrant) {
        throw new UnauthenticatedError({ message: "Missing turn grant" });
      }
      const grant = await verify(turnGrant, "soko-bot-core");
      if (
        grant.tokenUse !== "soko_bot_turn_grant" ||
        grant.userId !== userId ||
        grant.sokoBotId !== sokoBotId ||
        grant.workspaceId !== workspaceId ||
        grant.sessionId !== sessionIdClaim ||
        grant.turnId !== turnId
      ) {
        throw new UnauthenticatedError({
          message: "Turn grant scope mismatch",
        });
      }
      capabilities = Array.isArray(grant.capabilities)
        ? grant.capabilities.filter(
            (item): item is string =>
              typeof item === "string" && isSokoBotCapability(item),
          )
        : [];
    }

    return {
      attributes: {
        userId,
        sokoBotId,
        workspaceId,
        sessionIdClaim,
        turnId,
        turnGrant,
        capabilities: JSON.stringify(capabilities),
        model: typeof claims.model === "string" ? claims.model : "",
        inferenceRegion:
          typeof claims.inferenceRegion === "string"
            ? claims.inferenceRegion
            : "",
        versionId: typeof claims.versionId === "string" ? claims.versionId : "",
      },
      authenticator: "soko-bot:eddsa",
      issuer: requiredClaim(claims.iss, "issuer"),
      principalId: userId,
      principalType: "user",
      subject: requiredClaim(claims.sub, "subject"),
    };
  } catch (error) {
    if (error instanceof UnauthenticatedError) throw error;
    throw new UnauthenticatedError({ message: "Invalid Soko Bot request" });
  }
};

export default eveChannel({ auth: sokoBotAuth });
