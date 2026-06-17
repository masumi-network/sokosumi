-- Redefine compute_history_job_status to drop the dead DEMO branch.
-- The DEMO JobType value was removed in 20260616120100_remove_job_type_demo,
-- so the `jobType = 'DEMO'` check is now unreachable.
CREATE OR REPLACE FUNCTION compute_history_job_status(job_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  source_job RECORD;
  latest_status TEXT;
  latest_has_input BOOLEAN;
  payment_deadline TIMESTAMP(3);
BEGIN
  SELECT
    j.*,
    p."onChainStatus"::TEXT AS "onChainStatusText",
    p."nextAction"::TEXT AS "nextActionText"
  INTO source_job
  FROM "Job" AS j
  LEFT JOIN "jobPurchase" AS p ON p."jobId" = j."id"
  WHERE j."id" = job_id;

  IF NOT FOUND THEN
    RETURN 'started';
  END IF;

  SELECT e."status"::TEXT, i."id" IS NOT NULL
  INTO latest_status, latest_has_input
  FROM "jobEvent" AS e
  LEFT JOIN "jobInput" AS i ON i."eventId" = e."id"
  WHERE e."jobId" = job_id
  ORDER BY e."createdAt" DESC, e."id" DESC
  LIMIT 1;

  IF source_job."jobType"::TEXT = 'FREE' THEN
    IF latest_status IS NULL THEN
      RETURN 'started';
    END IF;

    CASE latest_status
      WHEN 'INITIATED' THEN RETURN 'processing';
      WHEN 'AWAITING_PAYMENT' THEN RETURN 'failed';
      WHEN 'AWAITING_INPUT' THEN
        IF latest_has_input THEN
          RETURN 'processing';
        END IF;
        RETURN 'input_required';
      WHEN 'RUNNING' THEN RETURN 'processing';
      WHEN 'COMPLETED' THEN RETURN 'completed';
      WHEN 'FAILED' THEN RETURN 'failed';
      ELSE RETURN 'failed';
    END CASE;
  END IF;

  IF source_job."refundedTransactionId" IS NOT NULL THEN
    RETURN 'refund_resolved';
  END IF;

  IF source_job."onChainStatusText" IS NULL
    AND source_job."nextActionText" IS NULL THEN
    payment_deadline := COALESCE(source_job."payByTime", source_job."createdAt");

    IF payment_deadline < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
      RETURN 'payment_failed';
    END IF;

    RETURN 'payment_pending';
  END IF;

  IF source_job."nextActionText" IN (
    'FUNDS_LOCKING_INITIATED',
    'FUNDS_LOCKING_REQUESTED'
  ) THEN
    RETURN 'payment_pending';
  END IF;

  IF source_job."nextActionText" IN (
    'SET_REFUND_REQUESTED_INITIATED',
    'SET_REFUND_REQUESTED_REQUESTED',
    'UNSET_REFUND_REQUESTED_INITIATED',
    'UNSET_REFUND_REQUESTED_REQUESTED'
  ) THEN
    RETURN 'refund_pending';
  END IF;

  IF latest_status IS NULL THEN
    RETURN 'started';
  END IF;

  IF source_job."onChainStatusText" IS NULL THEN
    RETURN 'payment_pending';
  END IF;

  CASE source_job."onChainStatusText"
    WHEN 'FUNDS_LOCKED' THEN
      CASE latest_status
        WHEN 'INITIATED' THEN RETURN 'payment_pending';
        WHEN 'AWAITING_PAYMENT' THEN RETURN 'payment_pending';
        WHEN 'AWAITING_INPUT' THEN
          IF latest_has_input THEN
            RETURN 'processing';
          END IF;
          RETURN 'input_required';
        WHEN 'COMPLETED' THEN RETURN 'completed';
        WHEN 'FAILED' THEN RETURN 'failed';
        ELSE
          IF source_job."externalDisputeUnlockTime" IS NOT NULL
            AND source_job."externalDisputeUnlockTime" < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
            RETURN 'failed';
          END IF;

          IF source_job."submitResultTime" IS NOT NULL
            AND source_job."submitResultTime" < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
            RETURN 'result_pending';
          END IF;

          RETURN 'processing';
      END CASE;
    WHEN 'RESULT_SUBMITTED' THEN
      IF latest_status = 'COMPLETED' THEN
        RETURN 'completed';
      END IF;
      RETURN 'result_pending';
    WHEN 'FUNDS_WITHDRAWN' THEN
      IF latest_status = 'COMPLETED' THEN
        RETURN 'completed';
      END IF;
      RETURN 'failed';
    WHEN 'FUNDS_OR_DATUM_INVALID' THEN RETURN 'payment_failed';
    WHEN 'REFUND_REQUESTED' THEN RETURN 'refund_pending';
    WHEN 'REFUND_WITHDRAWN' THEN RETURN 'refund_resolved';
    WHEN 'DISPUTED' THEN RETURN 'dispute_pending';
    WHEN 'DISPUTED_WITHDRAWN' THEN RETURN 'dispute_resolved';
    ELSE RETURN 'payment_pending';
  END CASE;
END;
$$;
