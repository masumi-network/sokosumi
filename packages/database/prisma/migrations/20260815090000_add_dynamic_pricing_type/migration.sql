-- Preserve registry-declared dynamic payment sources distinctly from malformed
-- or future pricing shapes. Dynamic x402 entries can then be shown as
-- non-payable previews without weakening fixed-price payment verification.
ALTER TYPE "PricingType" ADD VALUE IF NOT EXISTS 'DYNAMIC';
