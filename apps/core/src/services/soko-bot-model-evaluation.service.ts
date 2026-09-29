import prisma from "@/lib/db/prisma";
import { SOKO_BOT_ROUTE_MODEL } from "@/lib/soko-bot/classifier";
import {
  judgeCaseSummarySchema,
  judgeModelSummarySchema,
  routerCaseSummarySchema,
  routerModelSummarySchema,
} from "@/lib/soko-bot/model-evaluation";
import { sokoBotJudgeModel } from "@/services/soko-bot-lab-judge.service";

/** How many past runs of each kind the console shows. */
const HISTORY = 10;

function base(row: {
  id: string;
  createdAt: Date;
  label: string;
  inUseModel: string | null;
}) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    label: row.label,
    inUseModel: row.inUseModel,
  };
}

/** Recent judge and routing evaluations, newest first, for the admin console. */
export async function listSokoBotModelEvaluations() {
  const [judge, router] = await Promise.all(
    (["JUDGE", "ROUTER"] as const).map((kind) =>
      prisma.sokoBotModelEvaluation.findMany({
        where: { kind },
        orderBy: { createdAt: "desc" },
        take: HISTORY,
      }),
    ),
  );
  return {
    currentJudgeModel: sokoBotJudgeModel(),
    currentRouteModel: SOKO_BOT_ROUTE_MODEL,
    judge: judge.map((row) => ({
      ...base(row),
      models: judgeModelSummarySchema.array().parse(row.models),
      cases: judgeCaseSummarySchema.array().parse(row.cases),
    })),
    router: router.map((row) => ({
      ...base(row),
      models: routerModelSummarySchema.array().parse(row.models),
      cases: routerCaseSummarySchema.array().parse(row.cases),
    })),
  };
}
