-- Expand final-delivery cardinality without rewriting existing obligations.
-- The existing composite unique index remains authoritative for replay safety.
DROP INDEX "soko_bot_delivery_turnId_key";
