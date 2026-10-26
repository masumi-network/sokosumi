ALTER TABLE "social_post" ADD COLUMN "publishingThreadPartPosition" INTEGER;

CREATE TABLE "social_post_thread_part" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "media" JSONB NOT NULL DEFAULT '[]',
    "externalPostId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "social_post_thread_part_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_post_thread_part_position_check" CHECK ("position" BETWEEN 2 AND 25)
);

CREATE UNIQUE INDEX "social_post_thread_part_postId_position_key" ON "social_post_thread_part"("postId", "position");

ALTER TABLE "social_post_thread_part" ADD CONSTRAINT "social_post_thread_part_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
