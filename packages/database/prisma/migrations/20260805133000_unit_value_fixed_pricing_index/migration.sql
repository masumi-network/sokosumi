-- Agent sync deletes fixed-pricing rows by agentFixedPricingId on every
-- pricing replacement; without an index that is a sequential scan (and the
-- AgentFixedPricing delete's FK check scans too).
CREATE INDEX "UnitValue_agentFixedPricingId_idx" ON "UnitValue"("agentFixedPricingId");
