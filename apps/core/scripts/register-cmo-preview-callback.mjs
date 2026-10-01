// Preview builds only: lets this branch's CMO preview sign in against this
// branch's Core preview. Each Core preview has its own Neon branch, copied
// from production, so CMO's OAuth client there only knows the production
// callback. This adds the CMO preview's callback to that copy. It never runs
// outside Vercel Preview, so production's client is never touched.
import pg from "pg";

const PRODUCTION_CALLBACK = "https://app.cmo.xyz/api/auth/callback/sokosumi";

export function previewBranchSegment(ref) {
  return (ref ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cmoPreviewCallback(ref) {
  const segment = previewBranchSegment(ref);
  return segment
    ? `https://sokosumi-cmo-git-${segment}.preview.sokosumi.com/api/auth/callback/sokosumi`
    : null;
}

async function main() {
  if (process.env.VERCEL_ENV !== "preview") return;
  const callback = cmoPreviewCallback(process.env.VERCEL_GIT_COMMIT_REF);
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!callback || !connectionString) return;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE "oauthClient"
          SET "redirectUris" = array_append("redirectUris", $1)
        WHERE $2 = ANY("redirectUris") AND NOT ($1 = ANY("redirectUris"))`,
      [callback, PRODUCTION_CALLBACK],
    );
    console.log(`CMO preview callback: ${callback} (${result.rowCount} added)`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // A preview without CMO sign-in is still a working Core preview.
    console.warn("CMO preview callback not registered:", error.message);
  });
}
