-- AddForeignKey
ALTER TABLE "project_social_connection_intent" ADD CONSTRAINT "project_social_connection_intent_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES "project_social_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
