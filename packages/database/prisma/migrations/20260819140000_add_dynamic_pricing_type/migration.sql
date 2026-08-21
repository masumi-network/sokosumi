-- Formerly 20260815090000_add_dynamic_pricing_type. Re-timestamped after
-- 20260819130000_task_x402_payment so listing-stack migrations apply after
-- the main tip and the x402 table.
--
-- Preserve registry-declared dynamic payment sources distinctly from malformed
-- or future pricing shapes. Dynamic x402 entries can then be shown as
-- non-payable previews without weakening fixed-price payment verification.
ALTER TYPE "PricingType" ADD VALUE IF NOT EXISTS 'DYNAMIC';
