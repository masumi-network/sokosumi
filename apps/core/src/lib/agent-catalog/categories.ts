import type { NetworkScope } from "@/lib/db/network-scope";
import {
  buildAvailableAgentWhereClause,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "./availability";

export async function listCategoriesInUse(scope: NetworkScope) {
  const db = scope.networkDb;
  const creditCosts = await getCreditCostsOrThrow(db.creditCost);
  const cardanoV2ReadySources = await getCardanoV2ReadySources(
    scope.sharedDb,
    scope.network,
  );
  const agentWhere = buildAvailableAgentWhereClause(
    scope,
    creditCosts,
    cardanoV2ReadySources,
  );

  return await db.category.findMany({
    where: {
      agents: { some: agentWhere },
    },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
  });
}
