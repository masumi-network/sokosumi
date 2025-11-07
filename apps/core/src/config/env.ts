interface Env {
  PORT: number;
  DATABASE_URL: string;
  API_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  NODE_ENV: "development" | "production" | "test";
}

function getEnv(): Env {
  const port = parseInt(process.env.PORT || "3000", 10);
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.API_KEY;
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
  const betterAuthUrl =
    process.env.BETTER_AUTH_URL || `http://localhost:${port}`;
  const nodeEnv = (process.env.NODE_ENV || "development") as Env["NODE_ENV"];

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (!apiKey) {
    throw new Error("API_KEY is required");
  }

  if (!betterAuthSecret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }

  return {
    PORT: port,
    DATABASE_URL: databaseUrl,
    API_KEY: apiKey,
    BETTER_AUTH_SECRET: betterAuthSecret,
    BETTER_AUTH_URL: betterAuthUrl,
    NODE_ENV: nodeEnv,
  };
}

export const env = getEnv();
