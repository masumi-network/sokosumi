interface Env {
  PORT: number;
  DATABASE_URL: string;
  API_KEY: string;
  NODE_ENV: "development" | "production" | "test";
}

function getEnv(): Env {
  const port = parseInt(Bun.env.PORT || "3000", 10);
  const databaseUrl = Bun.env.DATABASE_URL;
  const apiKey = Bun.env.API_KEY;
  const nodeEnv = (Bun.env.NODE_ENV || "development") as Env["NODE_ENV"];

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (!apiKey) {
    throw new Error("API_KEY is required");
  }

  return {
    PORT: port,
    DATABASE_URL: databaseUrl,
    API_KEY: apiKey,
    NODE_ENV: nodeEnv,
  };
}

export const env = getEnv();
