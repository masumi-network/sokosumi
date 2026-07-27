-- Masumi payment node V2 contract adds two on-chain purchase states and two
-- purchasing next actions (WithdrawAuthorized/RefundAuthorized and
-- AuthorizeWithdrawal{Requested,Initiated}).
ALTER TYPE "OnChainJobStatus" ADD VALUE 'WITHDRAW_AUTHORIZED' AFTER 'RESULT_SUBMITTED';
ALTER TYPE "OnChainJobStatus" ADD VALUE 'REFUND_AUTHORIZED' AFTER 'REFUND_REQUESTED';
ALTER TYPE "NextJobAction" ADD VALUE 'AUTHORIZE_WITHDRAWAL_REQUESTED';
ALTER TYPE "NextJobAction" ADD VALUE 'AUTHORIZE_WITHDRAWAL_INITIATED';
