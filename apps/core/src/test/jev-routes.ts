import type { SokoBotRoute, TurnClassification } from "@sokosumi/soko-bot";

import type { RouteEvaluation } from "@/lib/soko-bot/classifier";

/** What Jev returns for a confident route, for tests that script the classifier. */
export function jevRoute(
  route: SokoBotRoute,
  options: {
    writeScope?: NonNullable<TurnClassification["writeScope"]>;
    confirmsPending?: number;
    probability?: number;
  } = {},
): RouteEvaluation {
  const scope = options.writeScope ?? "WORK";
  return {
    answers: {
      route: {
        choice: route,
        probabilities: { [route]: options.probability ?? 0.98 },
      },
      writeScope: {
        choice: scope,
        probabilities: { [scope]: options.writeScope ? 0.95 : 0.1 },
      },
      ...(options.confirmsPending === undefined
        ? {}
        : { confirmsPending: { probability: options.confirmsPending } }),
    },
    usage: { inputTokens: 300, outputTokens: 20 },
    providerMetadata: { gateway: { cost: "0.00001" } },
  };
}
