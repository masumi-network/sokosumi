-- Support ordered table history without scanning unrelated audit rows.
CREATE INDEX "table_change_tableId_sequence_idx" ON "table_change"("tableId", "sequence");
