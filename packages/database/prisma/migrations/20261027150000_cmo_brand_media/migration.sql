-- CMO.xyz: the owner approves the Brand Brain before his questions, and the
-- research screenshots and site pictures are kept with the hire.
ALTER TABLE "cmo_hire" ADD COLUMN "brandBrainApprovedAt" TIMESTAMP(3),
ADD COLUMN "brandMedia" JSONB;
