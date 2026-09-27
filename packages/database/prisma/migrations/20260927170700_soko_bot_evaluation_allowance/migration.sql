CREATE TABLE "SokoBotEvaluationAllowance" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'preview-evaluation'),
  "bindingHash" TEXT NOT NULL,
  "calls" JSONB NOT NULL DEFAULT '[]',
  "frozen" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "evaluation_calls_bound" CHECK (jsonb_typeof("calls") = 'array' AND jsonb_array_length("calls") <= 10)
);
