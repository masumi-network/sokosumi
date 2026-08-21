import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const backfillSql = readFileSync(
  join(
    packageRoot,
    "prisma/migrations/20260821140000_chat_room_user_mention/migration.sql",
  ),
  "utf8",
);

describe("chat_room_user_mention backfill", () => {
  it("inserts only mentioned CHAT notifications, not Direct pings", () => {
    expect(backfillSql).toContain(
      "AND n.\"messageKey\" = 'Notifications.Chat.mentioned'",
    );
    expect(backfillSql).not.toMatch(
      /messageKey\s*=\s*'Notifications\.Chat\.directMessage'/,
    );
  });
});
