ALTER TABLE "buzz_community" DROP CONSTRAINT "buzz_community_organizationId_fkey";
ALTER TABLE "buzz_community" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "buzz_community" ADD CONSTRAINT "buzz_community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
