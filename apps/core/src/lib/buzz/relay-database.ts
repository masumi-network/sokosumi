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
  if (!pool) {
    // Every statement bounded, so a run never waits past its lease on one.
    pool = new pg.Pool({
      connectionString: url,
      max: 2,
      statement_timeout: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // An idle connection the relay's database dropped: the next query
    // reconnects, and must not take the process down meanwhile.
    pool.on("error", (error) =>
      console.error("Buzz relay database connection lost", error.message),
    );
  }
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

/**
 * Deletes a DM the way the relay deletes a group, and its messages with it.
 * The relay lets no one delete a DM (its people are all plain members, and
 * only a message's author may delete it), so a Direct gone from Sokosumi is
 * removed here. True when it is gone; null without the relay's database.
 */
export async function deleteDirectMessage(
  host: string,
  channelId: string,
): Promise<boolean | null> {
  const database = relayDatabase();
  if (!database) return null;
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const community = await client.query<{ id: string }>(
      "SELECT id FROM communities WHERE lower(host) = lower($1) AND deleted_at IS NULL",
      [host],
    );
    const communityId = community.rows[0]?.id;
    if (!communityId) {
      await client.query("ROLLBACK");
      return true;
    }
    await client.query(
      "UPDATE events SET deleted_at = now() WHERE community_id = $1 AND channel_id = $2 AND deleted_at IS NULL",
      [communityId, channelId],
    );
    // Its people's hash freed: the same people may open a new DM later
    // (the relay keeps it unique, deleted or not).
    await client.query(
      `UPDATE channels SET deleted_at = coalesce(deleted_at, now()), participant_hash = NULL
        WHERE community_id = $1 AND id = $2`,
      [communityId, channelId],
    );
    await client.query(
      "UPDATE communities SET artifact_policy_modified_at = clock_timestamp() WHERE id = $1",
      [communityId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes one event in a DM, which no key may take down through the relay
 * (a DM has no admins; only its author may). True when done; null without
 * the relay's database.
 */
export async function deleteEventInRelay(
  host: string,
  eventId: string,
): Promise<boolean | null> {
  const database = relayDatabase();
  if (!database) return null;
  await database.query(
    `UPDATE events SET deleted_at = now()
      WHERE id = $2 AND deleted_at IS NULL
        AND community_id = (SELECT id FROM communities WHERE lower(host) = lower($1))`,
    [host, Buffer.from(eventId, "hex")],
  );
  return true;
}
