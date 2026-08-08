-- CreateEnum
CREATE TYPE "PushDevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "push_device" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "PushDevicePlatform" NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_device_pkey" PRIMARY KEY ("id")
);

-- Re-registering the same token for the same user updates the row rather than
-- adding a second one; the app registers on every launch.
-- CreateIndex
CREATE UNIQUE INDEX "push_device_userId_token_key" ON "push_device"("userId", "token");

-- A send failure knows only the token, and has to find every row holding it.
-- CreateIndex
CREATE INDEX "push_device_token_idx" ON "push_device"("token");

-- CreateIndex
CREATE INDEX "push_device_userId_idx" ON "push_device"("userId");

-- AddForeignKey
ALTER TABLE "push_device" ADD CONSTRAINT "push_device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
