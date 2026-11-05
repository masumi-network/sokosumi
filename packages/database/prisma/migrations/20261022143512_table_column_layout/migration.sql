-- Presentational column layout for the table view; null keeps the type's default.
ALTER TABLE "table_column" ADD COLUMN "width" INTEGER,
ADD COLUMN "wrap" BOOLEAN;
