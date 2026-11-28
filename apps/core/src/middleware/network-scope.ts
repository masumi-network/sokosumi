import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { badRequest, forbidden } from "@/helpers/error";
import {
  createNetworkScope,
  createRefusedNetworkScope,
  type NetworkScope,
  type SharedDb,
} from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  canUsePreprodInWorkspace,
  isNetworkRoutingEnabled,
  isPreprodOn,
  NETWORKS,
  type Network,
} from "@/lib/network";
import { USER_API_KEY_PREFIXES } from "@/lib/user-api-key";

import {
  type AuthenticationContext,
  type AuthVariables,
  authMiddleware,
} from "./auth";
import { organizationContextMiddleware } from "./organization";

/** The request header that names a request's Network, on `/v1` and `/auth`. */
export const NETWORK_HEADER = "X-Sokosumi-Network";

/** The context key of the Network the request names, once parsed. */
const PARSED_NETWORK = "requestNetwork";

interface NamedNetwork {
  network: Network;
  /** Whether the request sent the header: without it the Network is Mainnet. */
  sent: boolean;
}

export interface NetworkScopeVariables {
  networkScope: NetworkScope;
}

/**
 * The Network a request names in `X-Sokosumi-Network`: Mainnet without the
 * header, 400 `network_unknown` for a value that is not a Network, never a
 * fallback to Mainnet.
 */
export function requestNetwork(c: Context): Network {
  return namedNetwork(c).network;
}

function namedNetwork(c: Context): NamedNetwork {
  // Parsed once per request, by the first caller (`requestNetworkMiddleware`).
  const parsed: NamedNetwork | undefined = c.get(PARSED_NETWORK);
  if (parsed) return parsed;
  const value = c.req.header(NETWORK_HEADER);
  const network =
    value === undefined
      ? "mainnet"
      : NETWORKS.find((candidate) => candidate === value);
  if (!network) {
    throw badRequest(
      `${NETWORK_HEADER} must be one of ${NETWORKS.join(", ")}`,
      { kind: CORE_API_ERROR_KINDS.NETWORK_UNKNOWN },
    );
  }
  const named = { network, sent: value !== undefined };
  c.set(PARSED_NETWORK, named);
  return named;
}

/**
 * Answers 400 to a request whose header names no Network, on every route.
 * Mounted after CORS, so a browser can read the answer.
 */
export const requestNetworkMiddleware = createMiddleware(async (c, next) => {
  requestNetwork(c);
  await next();
});

/**
 * Whether the caller may use Preprod in the Workspace of the request: a
 * person's browser session, API key or OAuth token (first- or third-party).
 * A platform admin always; otherwise the user's flag for the personal
 * Workspace, the Organization's flag and the membership for an Organization
 * Workspace. An impersonated session carries the impersonated person's user
 * and role, so it gets their access.
 *
 * Still refused: an MCP token (its context has no `oauthClientId`, and its
 * tool calls send no header; ticket 36), a Coworker key (its payments ask
 * `paymentScope`) and a Soko Bot key (ticket 30).
 */
export async function hasPreprodAccess(
  authContext: AuthenticationContext | undefined,
): Promise<boolean> {
  if (authContext?.actor !== "user") return false;
  const { authenticationMethod, oauthClientId } = authContext;
  if (
    authenticationMethod !== "session" &&
    authenticationMethod !== "api_key" &&
    !(authenticationMethod === "oauth" && oauthClientId)
  ) {
    return false;
  }
  const { userId, organizationId, role } = authContext;
  // An admin's role decides, so no flag is read.
  if (canUsePreprodInWorkspace({}, role, { organization: null })) return true;
  if (organizationId) {
    const member = await prisma.member.findFirst({
      where: { organizationId, userId, organization: { preprodEnabled: true } },
      select: { id: true },
    });
    return canUsePreprodInWorkspace({}, role, {
      organization: { preprodEnabled: member !== null },
    });
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preprodEnabled: true },
  });
  return canUsePreprodInWorkspace(user ?? {}, role, { organization: null });
}

/**
 * The Preprod scope of a caller, or one that refuses on its Network side:
 * 403 `preprod_off` while Preprod is off (no read, no caller resolved), 403
 * `preprod_access_required` without access. The shared side works either way,
 * so a route that serves shared data is never refused because of the Network.
 */
export async function preprodScopeFor(
  caller: () => Promise<AuthenticationContext | undefined>,
): Promise<NetworkScope> {
  if (!isPreprodOn()) {
    return createRefusedNetworkScope(
      forbidden("Preprod is switched off", {
        kind: CORE_API_ERROR_KINDS.PREPROD_OFF,
      }),
    );
  }
  if (await hasPreprodAccess(await caller())) {
    return createNetworkScope("preprod");
  }
  return createRefusedNetworkScope(
    forbidden("You have no Preprod access in this workspace", {
      kind: CORE_API_ERROR_KINDS.PREPROD_ACCESS_REQUIRED,
    }),
  );
}

/**
 * Resolves the effective Network of an authenticated caller from
 * `X-Sokosumi-Network` and a verified API key's Network (`apiKeyNetwork`).
 * Returns `mismatchError` (403 `api_key_network_mismatch`) when the header
 * explicitly contradicts the key's Network. Unknown header values throw 400
 * `network_unknown` via `namedNetwork`.
 */
export function resolveCallerNetwork(
  c: Context,
  caller: AuthenticationContext | undefined = c.get("authContext") as
    | AuthenticationContext
    | undefined,
): { network: Network; mismatchError: HTTPException | null } {
  const { network, sent } = namedNetwork(c);
  const keyNetwork =
    caller?.actor === "user" ? caller.apiKeyNetwork : undefined;
  if (keyNetwork && sent && keyNetwork !== network) {
    return {
      network,
      mismatchError: forbidden(
        `This API key is for ${keyNetwork}, and ${NETWORK_HEADER} names ${network}`,
        { kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH },
      ),
    };
  }
  return {
    network: sent ? network : (keyNetwork ?? network),
    mismatchError: null,
  };
}

/**
 * The scope of an authenticated request. An API key carries its Network while
 * Preprod is on (`apiKeyNetwork`): without the header the request is for the
 * key's Network, and a header that names the other one gets a scope that
 * refuses on its Network side with 403 `api_key_network_mismatch` (shared data
 * answers as for any key). Otherwise the header decides, Mainnet without it.
 * `access` is whom the Preprod access check asks: the caller, or no one when
 * the caller is refused the request's Workspace.
 */
async function callerScope(
  c: Context,
  caller: AuthenticationContext | undefined,
  access: AuthenticationContext | undefined,
): Promise<NetworkScope> {
  const { network, mismatchError } = resolveCallerNetwork(c, caller);
  if (mismatchError) {
    return createRefusedNetworkScope(mismatchError);
  }
  return network === "mainnet"
    ? createNetworkScope("mainnet")
    : preprodScopeFor(async () => access);
}

/** Whom a Coworker's payment is billed to: a Task's Owner and Organization, or a usage call's. */
export interface BilledParty {
  userId: string | null;
  organizationId: string | null;
}

/**
 * The scope for a Coworker's payment (a Task event's charge, an x402 payment,
 * usage). The billed party is known only in the route, so the route asks
 * here, before the charge, with the open transaction for the access read.
 *
 * While Preprod is off this is the request's own scope, and a payload names no
 * Network. While it is on: the Network the payload names, else the header's,
 * else Mainnet, and a payload and a header that disagree are 400
 * `network_mismatch`. Preprod needs the billed party's flag: the
 * Organization's when the payment is billed to one, else the user's; no admin
 * shortcut, and only for a Coworker (a Soko Bot is ticket 30). A Mainnet
 * payment reads nothing.
 */
export async function paymentScope(
  // An authenticated router's context: a public one has neither variable.
  c: Context<EnvVariables>,
  payment: {
    /** The Network the payload names, if it names one. */
    payloadNetwork?: Network;
    billed: BilledParty;
    db: SharedDb;
  },
): Promise<NetworkScope> {
  const { networkScope, authContext } = c.var;
  if (!isNetworkRoutingEnabled()) return networkScope;
  const header = namedNetwork(c);
  const { payloadNetwork, billed, db } = payment;
  if (payloadNetwork && header.sent && payloadNetwork !== header.network) {
    throw badRequest(
      `This payment is for ${payloadNetwork}, and ${NETWORK_HEADER} names ${header.network}`,
      { kind: CORE_API_ERROR_KINDS.NETWORK_MISMATCH },
    );
  }
  if ((payloadNetwork ?? header.network) === "mainnet") {
    return createNetworkScope("mainnet");
  }
  if (!isPreprodOn()) {
    throw forbidden("Preprod is switched off", {
      kind: CORE_API_ERROR_KINDS.PREPROD_OFF,
    });
  }
  if (
    authContext?.actor !== "coworker" ||
    !(await billedPartyHasPreprod(billed, db))
  ) {
    throw forbidden("The billed workspace has no Preprod access", {
      kind: CORE_API_ERROR_KINDS.PREPROD_ACCESS_REQUIRED,
    });
  }
  return createNetworkScope("preprod");
}

/**
 * The scope of the Network a Coworker's payment call names in its header, for
 * looking up an earlier payment with the same key before `paymentScope` is
 * asked: a replay moves no money, so no billed party's access is read, and one
 * that lost its access since still learns whether its charge landed. 403
 * `preprod_off` for Preprod while Preprod is off, before any read. Reads
 * nothing.
 */
export function namedPaymentScope(c: Context): NetworkScope {
  const network = requestNetwork(c);
  if (network === "preprod" && !isPreprodOn()) {
    throw forbidden("Preprod is switched off", {
      kind: CORE_API_ERROR_KINDS.PREPROD_OFF,
    });
  }
  return createNetworkScope(network);
}

/** Ticket 31's rule with no role: a payment has no admin shortcut. */
async function billedPartyHasPreprod(
  { userId, organizationId }: BilledParty,
  db: SharedDb,
): Promise<boolean> {
  if (organizationId) {
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { preprodEnabled: true },
    });
    return canUsePreprodInWorkspace({}, null, {
      organization: organization ?? {},
    });
  }
  if (!userId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { preprodEnabled: true },
  });
  return canUsePreprodInWorkspace(user ?? {}, null, { organization: null });
}

/**
 * Creates the Network scope of a request for the Network it names, once the
 * Organization of the request is known. Handlers read `c.var.networkScope`
 * and pass it, or one side of it, down as an argument. A Mainnet request
 * reads nothing.
 */
export const networkScopeMiddleware = createMiddleware<{
  Variables: Partial<NetworkScopeVariables & AuthVariables>;
}>(async (c, next) => {
  // A nested router runs this again: the request keeps its one scope.
  if (!c.var.networkScope) {
    // The one place an authenticated request names its Network; a public
    // route calls `publicRequestNetworkScope`.
    c.set(
      "networkScope",
      await callerScope(c, c.var.authContext, c.var.authContext),
    );
  }
  await next();
});

/**
 * The scope for a public route, which has no authentication middleware:
 * Mainnet as without the header, reading nothing. For Preprod, and while
 * Preprod is on for a bearer that may be a Preprod API key, the caller is
 * authenticated here, as an authenticated router would; an anonymous caller
 * (or one whose credential fails) has no access.
 */
export async function publicRequestNetworkScope(
  c: Context,
): Promise<NetworkScope> {
  const network = requestNetwork(c);
  if (!isNetworkRoutingEnabled()) {
    return network === "mainnet"
      ? createNetworkScope("mainnet")
      : preprodScopeFor(async () => undefined);
  }
  if (
    network === "mainnet" &&
    !PREPROD_KEY_BEARER.test(c.req.header("authorization") ?? "")
  ) {
    return createNetworkScope("mainnet");
  }
  const { caller, access } = await publicCaller(c);
  return callerScope(c, caller, access);
}

/**
 * A bearer whose token starts with the Preprod key prefix, in the syntax
 * Hono's `bearerAuth` (`middleware/auth.ts`) accepts: the scheme in any case,
 * one space, then any whitespace. The stored row's prefix decides once the key
 * verifies; the plugin writes the same prefix into a key's text and its row,
 * so for a key Core minted the two cannot differ.
 * A longer caller-chosen prefix (before #8437) would match too: on a fork of
 * production on 2026-11-27, none of 311 keys had a stored prefix or text
 * starting with `soko_preprod_`, and Core has refused a caller's prefix since.
 */
const PREPROD_KEY_BEARER = new RegExp(
  `^(?i:bearer) \\s*${USER_API_KEY_PREFIXES.preprod}`,
);

/**
 * The caller of a public route, authenticated as an authenticated router
 * would, and whom the access check asks: no one when the caller is refused
 * the Workspace it names, though a verified key keeps its Network.
 */
async function publicCaller(c: Context): Promise<{
  caller?: AuthenticationContext;
  access?: AuthenticationContext;
}> {
  let caller: AuthenticationContext | undefined;
  let access: AuthenticationContext | undefined;
  try {
    await authMiddleware(c, async () => {
      caller = c.var.authContext;
      try {
        await organizationContextMiddleware(c, async () => {
          access = c.var.authContext;
        });
      } catch (error) {
        // A non-member naming an Organization: no access in it.
        if (error instanceof HTTPException && error.status === 403) return;
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) return {};
    throw error;
  }
  return { caller, access };
}
