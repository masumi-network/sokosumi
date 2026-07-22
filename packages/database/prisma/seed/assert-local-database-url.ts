const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

export function isLocalDatabaseHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

export function assertLocalDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required to run the local database seed");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`Invalid DATABASE_URL: ${databaseUrl}`);
  }

  if (!isLocalDatabaseHost(parsed.hostname)) {
    throw new Error(
      `Refusing to seed non-local database host "${parsed.hostname}". ` +
        "Use a local PostgreSQL instance (localhost / 127.0.0.1).",
    );
  }
}
