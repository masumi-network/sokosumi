export interface MigrateDatabaseUrlEnv {
  DATABASE_URL_UNPOOLED?: string;
  POSTGRES_URL_NON_POOLING?: string;
  DATABASE_URL?: string;
}

export type MigrateDatabaseUrlSource =
  | "database_url_unpooled"
  | "postgres_url_non_pooling"
  | "neon_derived_from_pooler"
  | "neon_direct_database_url";

export interface ResolvedMigrateDatabaseUrl {
  url: string;
  source: MigrateDatabaseUrlSource;
}

const NEON_POOLER_HOST = /-pooler(\.[a-z0-9.-]*neon\.tech)/i;
const NEON_DIRECT_HOST = /\.neon\.tech/i;

/** Strip Neon's PgBouncer `-pooler` hostname segment for DDL/migrate. */
export function deriveNeonUnpooledFromPooled(
  connectionUrl: string,
): string | null {
  if (!NEON_POOLER_HOST.test(connectionUrl)) {
    return null;
  }
  return connectionUrl.replace(NEON_POOLER_HOST, "$1");
}

function resolveExplicitUnpooled(
  env: MigrateDatabaseUrlEnv,
): ResolvedMigrateDatabaseUrl | null {
  const unpooled = env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) {
    return { url: unpooled, source: "database_url_unpooled" };
  }

  const legacy = env.POSTGRES_URL_NON_POOLING?.trim();
  if (legacy) {
    return { url: legacy, source: "postgres_url_non_pooling" };
  }

  return null;
}

/** Resolve the direct Postgres URL Prisma migrate deploy should use on Vercel. */
export function resolveMigrateDatabaseUrl(
  env: MigrateDatabaseUrlEnv,
): ResolvedMigrateDatabaseUrl | null {
  const explicit = resolveExplicitUnpooled(env);
  if (explicit) {
    return explicit;
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return null;
  }

  const derived = deriveNeonUnpooledFromPooled(databaseUrl);
  if (derived) {
    return { url: derived, source: "neon_derived_from_pooler" };
  }

  if (NEON_DIRECT_HOST.test(databaseUrl)) {
    return { url: databaseUrl, source: "neon_direct_database_url" };
  }

  return null;
}
