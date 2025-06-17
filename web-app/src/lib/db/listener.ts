"use server";

import { Client } from "pg";

import { getEnvSecrets } from "@/config/env.config";

let pgClient: Client | null = null;
type Send = (data: string) => void;
const connections = new Set<Send>();

export async function initJobStatusListener() {
  if (pgClient) return;

  pgClient = new Client({
    connectionString: getEnvSecrets().DATABASE_URL,
  });

  await pgClient.connect();
  await pgClient.query("LISTEN job_status_updated");

  pgClient.on("notification", (msg) => {
    const { channel, payload } = msg;
    if (channel === "job_status_updated" && !!payload) {
      connections.forEach((connection) => {
        connection(payload);
      });
    }
  });

  pgClient.on("error", (err) => {
    console.error("PostgreSQL listener error:", err);
  });

  console.log("🔔 Listening to job_status_updated channel");

  return;
}

export async function subscribeConnection(send: Send): Promise<() => void> {
  connections.add(send);
  console.log("🔔 Subscribed connection");
  return () => {
    connections.delete(send);
    console.log("🔔 Unsubscribed connection");
  };
}
