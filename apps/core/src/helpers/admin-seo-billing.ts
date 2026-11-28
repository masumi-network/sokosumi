import { PrismaRaw } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import {
  convertCreditsToCents,
  SEO_FULL_AUDIT_CREDITS,
  SEO_FULL_AUDIT_MARKUP_PERCENT,
} from "@sokosumi/utils";
import { taskEventCountsOn } from "@/lib/credits/policy";
import type { Network } from "@/lib/network";

export const SEO_PRICE_PENDING_COMMENT =
  "The audit finished. Its final price is pending while we verify the cost receipts. No credits have been charged.";

const CREDITS_PER_USD = 100;
const MICRO_USD_PER_USD = 1_000_000;
const CREDIT_UNITS = convertCreditsToCents(1);
const BILLING_NETWORK: Network = "mainnet";

/** Compute payment status once so pagination, counts, alerts and the billing breakdown agree. */
export function seoBillingCtes() {
  // The SQL form of `taskEventCountsOn`: a Preprod receipt of an equal transaction id never counts as Mainnet debit evidence.
  const eventCountsOnNetwork = taskEventCountsOn(null, BILLING_NETWORK)
    ? PrismaRaw.sql`(e."network" IS NULL OR e."network" = ${BILLING_NETWORK})`
    : PrismaRaw.sql`e."network" = ${BILLING_NETWORK}`;
  return PrismaRaw.sql`
  billing_evidence AS (
    SELECT r.run, r.task_status, r.needs_credits, r.retrying, r.price_pending,
      r.request #> '{price,maxCredits}' AS cap, paid.debit, paid.charges, paid.matched,
      attempt.cents AS attempted, r.request ? 'fullAuditCost' AS settled_receipt,
      coalesce(r.request -> 'fullAuditCost', r.request -> 'pendingFullAuditCost') AS receipt,
      CASE WHEN jsonb_typeof(r.request #> '{limits,usd}')='number'
        THEN (r.request #>> '{limits,usd}')::numeric END AS data_budget
    FROM progress r
    LEFT JOIN LATERAL (
      SELECT sum(-d.amount::numeric) AS debit, count(*) AS charges,
        bool_and(EXISTS (SELECT 1 FROM ${sharedTable("taskEvent")} e WHERE e."taskId"=r."taskId"
          AND e."transactionId"=d.id AND ${eventCountsOnNetwork} AND e.cents=-d.amount::numeric AND e.status='COMPLETED'
          AND e."coworkerId"=r.approved_worker AND e."userId" IS NULL AND e."sokoBotId" IS NULL)) AS matched
      FROM ${netTable("mainnet", "Transaction")} d WHERE d.amount < 0 AND EXISTS (
        SELECT 1 FROM ${sharedTable("taskEvent")} e WHERE e."taskId"=r."taskId" AND e."transactionId"=d.id AND ${eventCountsOnNetwork})
    ) paid ON true
    LEFT JOIN LATERAL (
      SELECT e.cents FROM ${sharedTable("taskEvent")} e WHERE e."taskId"=r."taskId" AND e."coworkerId"=r.approved_worker
        AND e."userId" IS NULL AND e."sokoBotId" IS NULL AND e.cents > 0
        AND e.status IN ('COMPLETED','OUT_OF_CREDITS')
      ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1
    ) attempt ON true
    WHERE r.metered
  ), billing_amounts AS (
    SELECT b.*, CASE WHEN receipt -> 'version' = '1'::jsonb
      AND jsonb_typeof(receipt)='object'
      AND (CASE WHEN jsonb_typeof(receipt)='object' THEN receipt - ARRAY['version','gatewayMicroUsd','directModelMicroUsd','dataForSeoMicroUsd','otherApiMicroUsd'] END) = '{}'::jsonb
      AND parts.n=4 AND parts.total <= ${Number.MAX_SAFE_INTEGER}::numeric
      THEN least((cap #>> '{}')::numeric, greatest(${SEO_FULL_AUDIT_CREDITS}::numeric,
        ceil(parts.total * ${CREDITS_PER_USD * (1 + SEO_FULL_AUDIT_MARKUP_PERCENT / 100)}::numeric / ${MICRO_USD_PER_USD}::numeric))) * ${CREDIT_UNITS}::numeric
      END AS receipt_units, parts.data_cost
    FROM billing_evidence b LEFT JOIN LATERAL (
      SELECT count(n) FILTER (WHERE n>=0 AND n=trunc(n)) AS n, sum(n) AS total,
        max(n) FILTER (WHERE k='dataForSeoMicroUsd') AS data_cost
      FROM (SELECT k, CASE WHEN jsonb_typeof(b.receipt -> k)='number'
        THEN (b.receipt ->> k)::numeric END AS n
        FROM unnest(ARRAY['gatewayMicroUsd','directModelMicroUsd','dataForSeoMicroUsd','otherApiMicroUsd']) k) v
    ) parts ON true
  ), billing_state AS (
    SELECT b.*,
      CASE WHEN charges=1 AND matched AND settled_receipt AND receipt_units=debit THEN 'settled'
        WHEN charges>0 OR settled_receipt OR task_status='COMPLETED'
          OR (receipt IS NOT NULL AND (receipt_units IS NULL OR receipt_units IS DISTINCT FROM attempted)) THEN 'unverified'
        WHEN task_status IN ('FAILED','CANCELED') AND receipt IS NOT NULL THEN 'abandoned'
        WHEN task_status IN ('FAILED','CANCELED') THEN 'closed'
        WHEN needs_credits THEN 'needsCredits' WHEN retrying THEN 'retrying'
        WHEN price_pending THEN 'receiptsPending' ELSE 'inProgress' END AS billing_status,
      coalesce(receipt_units IS NOT NULL AND data_cost > data_budget * ${MICRO_USD_PER_USD}::numeric, false) AS over_budget
    FROM billing_amounts b
  ), billing_summary AS (
    SELECT run, cap, billing_status, data_budget, over_budget,
      attempted / ${CREDIT_UNITS}::numeric AS attempted_credits, debit / ${CREDIT_UNITS}::numeric AS charged_credits,
      CASE WHEN billing_status <> 'unverified' AND receipt_units IS NOT NULL THEN receipt END AS cost
    FROM billing_state
  )`;
}
