-- Remote MCP servers an owner added to a personal Soko Bot (ADR 0074).
CREATE TABLE "soko_bot_mcp_server" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authKind" TEXT NOT NULL,
    "credentialCiphertext" TEXT,
    "credentialKeyId" TEXT,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "toolsRefreshedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "soko_bot_mcp_server_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soko_bot_mcp_server_sokoBotId_name_key" ON "soko_bot_mcp_server"("sokoBotId", "name");

ALTER TABLE "soko_bot_mcp_server" ADD CONSTRAINT "soko_bot_mcp_server_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
