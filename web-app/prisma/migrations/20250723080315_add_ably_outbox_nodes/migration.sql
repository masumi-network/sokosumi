-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL,
    "expiry" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "sequence_id" SERIAL NOT NULL,
    "mutation_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "headers" JSONB,
    "locked_by" TEXT,
    "lock_expiry" TIMESTAMP(6),
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("sequence_id")
);
