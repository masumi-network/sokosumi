import { getX402ReadySources as readX402Readiness } from "@/lib/agent-catalog/availability";
import type { SharedDb } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { Network } from "@/lib/network";

export {
  findX402ReadySource,
  getAllowedX402Caip2Networks,
  getTrustedX402ExactEvmDomain,
  getX402AgentCatalogWhere,
  hasValidX402DiscoveryUrl,
  isX402NetworkAllowed,
  requiresX402AgentCuration,
  trimEvmWalletId,
  X402_BUY_SIDE_READINESS_FAILURE_KEY,
  X402_BUY_SIDE_READINESS_KEY,
  type X402ReadySource,
  type X402TrustedExactEvmDomain,
  x402ChainNetwork,
} from "@/lib/agent-catalog/x402";

export const getX402ReadySources = (
  tx: SharedDb = prisma,
  // shortcut: callers off the Network scope read Mainnet's row; they pass their scope's Network when they move to it.
  network: Network = "mainnet",
) => readX402Readiness(tx, network);
