/**
 * Our relay's own Postgres (`BUZZ_RELAY_DATABASE_URL`), for what its
 * protocol does not offer: importing history, and seeing whether an invite
 * was used. Null when not configured.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { getEnv } from "@/config/env";

let pool: pg.Pool | undefined;

export function relayDatabase(): pg.Pool | null {
  const url = getEnv().BUZZ_RELAY_DATABASE_URL;
  if (!url) return null;
  pool ??= new pg.Pool({ connectionString: url, max: 2 });
  return pool;
}

/**
 * Whether the person's Buzz app has joined the community of every one of
 * these invites: the invite was used, or (their key being a member already,
 * which the relay does not count as a use) the app has posted its profile
 * there, the last step of joining. Null when the relay's database is not
 * configured.
 */
export async function joinedWithInvites(
  codes: string[],
  appPubkey: string,
): Promise<boolean | null> {
  const database = relayDatabase();
  if (!database) return null;
  const unique = [...new Set(codes)];
  if (unique.length === 0) return false;
  const hashes = unique.map((code) =>
    createHash("sha256").update(code, "utf8").digest(),
  );
  const result = await database.query<{ invites: number; joined: number }>(
    `SELECT count(*)::int AS invites,
            count(*) FILTER (
              WHERE i.use_count > 0 OR EXISTS (
                SELECT 1 FROM events e
                 WHERE e.community_id = i.community_id
                   AND e.pubkey = $2 AND e.kind = 0 AND e.deleted_at IS NULL
              )
            )::int AS joined
       FROM relay_invites i
      WHERE i.token_hash = ANY($1)`,
    [hashes, Buffer.from(appPubkey, "hex")],
  );
  const row = result.rows[0];
  return (
    row !== undefined &&
    row.invites === unique.length &&
    row.joined === unique.length
  );
}
