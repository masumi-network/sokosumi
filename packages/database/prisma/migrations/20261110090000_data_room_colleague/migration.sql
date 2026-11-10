-- CreateTable
CREATE TABLE "data_room_colleague" (
    "roomId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_room_colleague_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateIndex
CREATE INDEX "data_room_colleague_userId_idx" ON "data_room_colleague"("userId");

-- AddForeignKey
ALTER TABLE "data_room_colleague" ADD CONSTRAINT "data_room_colleague_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "data_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_colleague" ADD CONSTRAINT "data_room_colleague_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

