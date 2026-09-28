ALTER TABLE "social_post" ADD COLUMN "scheduledByCoworkerId" TEXT;
CREATE INDEX "social_post_scheduledByCoworkerId_idx" ON "social_post"("scheduledByCoworkerId");
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_scheduledByCoworkerId_fkey"
FOREIGN KEY ("scheduledByCoworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
