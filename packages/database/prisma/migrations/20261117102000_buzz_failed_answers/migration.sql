-- Failed answers to a Buzz question, counted across bridge runs.
ALTER TABLE "buzz_message_link" ADD COLUMN "failedAnswers" INTEGER NOT NULL DEFAULT 0;
