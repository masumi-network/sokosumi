CREATE TYPE "SokoBotModelEvaluationKind" AS ENUM ('JUDGE', 'ROUTER');

CREATE TABLE "soko_bot_model_evaluation" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" "SokoBotModelEvaluationKind" NOT NULL,
  "label" TEXT NOT NULL,
  "inUseModel" TEXT,
  "models" JSONB NOT NULL,
  "cases" JSONB NOT NULL,
  CONSTRAINT "soko_bot_model_evaluation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "soko_bot_model_evaluation_kind_createdAt_idx" ON "soko_bot_model_evaluation"("kind", "createdAt" DESC);
