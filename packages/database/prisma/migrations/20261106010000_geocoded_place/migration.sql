-- CreateTable
CREATE TABLE "geocoded_place" (
    "query" TEXT NOT NULL,
    "label" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocoded_place_pkey" PRIMARY KEY ("query")
);
