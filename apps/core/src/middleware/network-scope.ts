import { CORE_API_ERROR_KINDS, hasAdminRole } from "@sokosumi/utils";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { badRequest, forbidden } from "@/helpers/error";
import {
  createNetworkScope,
  createRefusedNetworkScope,
  type NetworkScope,
} from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { isPreprodOn, NETWORKS, type Network } from "@/lib/network";

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

export interface NetworkScopeVariables {
  networkScope: NetworkScope;
}

/**
 * The Network a request names in `X-Sokosumi-Network`: Mainnet without the
 * header, 400 `network_unknown` for a value that is not a Network, never a
 * fallback to Mainnet.
 */
export function requestNetwork(c: Context): Network {
  // Parsed once per request, by the first caller (`requestNetworkMiddleware`).
  const parsed: Network | undefined = c.get(PARSED_NETWORK);
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
  c.set(PARSED_NETWORK, network);
  return network;
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
 * browser session only (keys, tokens, Coworkers and Soko Bots wait for
 * tickets 21 and 30). A platform admin always; otherwise the user's flag for
 * the personal Workspace, the Organization's flag and the membership for an
 * Organization Workspace. An impersonated session carries the impersonated
 * person's user and role, so it gets their access.
 */
async function hasPreprodAccess(
  authContext: AuthenticationContext | undefined,
): Promise<boolean> {
  if (
    authContext?.actor !== "user" ||
    authContext.authenticationMethod !== "session"
  ) {
    return false;
  }
  if (hasAdminRole(authContext.role)) return true;
  const { userId, organizationId } = authContext;
  if (organizationId) {
    const member = await prisma.member.findFirst({
      where: { organizationId, userId, organization: { preprodEnabled: true } },
      select: { id: true },
    });
    return member !== null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preprodEnabled: true },
  });
  return user?.preprodEnabled === true;
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
      requestNetwork(c) === "mainnet"
        ? createNetworkScope("mainnet")
        : await preprodScopeFor(async () => c.var.authContext),
    );
  }
  await next();
});

/**
 * The scope for a public route, which has no authentication middleware:
 * Mainnet as without the header, reading nothing. For Preprod the caller is
 * authenticated here, as an authenticated router would; an anonymous caller
 * (or one whose credential fails) has no access.
 */
export async function publicRequestNetworkScope(
  c: Context,
): Promise<NetworkScope> {
  if (requestNetwork(c) === "mainnet") return createNetworkScope("mainnet");
  return preprodScopeFor(async () => {
    let caller: AuthenticationContext | undefined;
    try {
      await authMiddleware(c, async () => {
        try {
          await organizationContextMiddleware(c, async () => {
            caller = c.var.authContext;
          });
        } catch (error) {
          // A non-member naming an Organization: no access in it.
          if (error instanceof HTTPException && error.status === 403) return;
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof HTTPException && error.status === 401) {
        return undefined;
      }
      throw error;
    }
    return caller;
  });
}
