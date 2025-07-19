import "server-only";

import pLimit from "p-limit";
import { Client, Notification } from "pg";

import { getEnvSecrets } from "@/config/env.secrets";

// Connection management with limits and health checks
const MAX_CONNECTIONS = 10000; // Adjust based on your server capacity
const BROADCAST_CONCURRENCY = 50; // Process 50 connections concurrently
const PG_RECONNECT_INTERVAL = 5000; // 5 seconds

// keep alive interval for SSE connection
let keepAliveInterval: NodeJS.Timeout | null = null;
const KEEP_ALIVE_INTERVAL = 30000; // 30 seconds

type Connection = (payload: string, ping?: boolean) => void;

let pgClient: Client | null = null;
const connections = new Map<string, Connection>();

export async function initJobStatusListener() {
  if (pgClient) return;

  pgClient = new Client({
    connectionString: getEnvSecrets().DATABASE_URL,
  });

  await pgClient.connect();
  await pgClient.query("LISTEN job_status_updated");

  pgClient.off("notification", onNotification);
  pgClient.off("error", onError);

  pgClient.on("notification", onNotification);
  pgClient.on("error", onError);

  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  keepAliveInterval = setInterval(
    () => broadcastToConnections("", true),
    KEEP_ALIVE_INTERVAL,
  );

  console.log("🔔 Listening to job_status_updated channel");

  return;
}

async function onNotification(msg: Notification) {
  const { channel, payload } = msg;
  if (channel === "job_status_updated" && !!payload) {
    await broadcastToConnections(payload);
  }
}

async function onError(err: Error) {
  console.error("PostgreSQL listener error:", err);
  // Attempt to reconnect
  setTimeout(() => {
    pgClient = null;
    initJobStatusListener();
  }, PG_RECONNECT_INTERVAL);
}

async function broadcastToConnections(
  payload: string,
  ping: boolean = false,
): Promise<void> {
  const startTime = Date.now();
  const deadConnectionIds: string[] = [];
  const tasks: Promise<void>[] = [];
  let results: PromiseSettledResult<void>[] = [];

  // Create a concurrency limiter
  const limit = pLimit(BROADCAST_CONCURRENCY);

  // Create tasks for each connection with controlled concurrency
  connections.forEach((connection, connectionId) =>
    tasks.push(
      limit(async () => {
        try {
          connection(payload, ping);
        } catch (error) {
          console.error(`Failed to send to connection ${connectionId}:`, error);
          deadConnectionIds.push(connectionId);
        }
      }),
    ),
  );

  // Execute all tasks with controlled concurrency
  try {
    results = await Promise.allSettled(tasks);
  } catch (error) {
    console.error(`${ping ? "Ping" : "Broadcast"} error:`, error);
  }

  const successfulConnections = results.filter(
    (result) => result.status === "fulfilled",
  );

  // Clean up dead connections
  deadConnectionIds.forEach((id) => connections.delete(id));

  const duration = Date.now() - startTime;
  console.log(
    `🔔 ${ping ? "Ping" : "Broadcast"} to ${successfulConnections.length} connections in ${duration}ms (${deadConnectionIds.length} dead)`,
  );
}

export function subscribeConnection(
  send: Connection,
  userId: string,
): () => void {
  const currentConnections = connections.size;

  // Check connection limit
  if (connections.size >= MAX_CONNECTIONS) {
    throw new Error("Maximum connections reached");
  }

  const connectionId = `conn_${currentConnections}_${userId}_${Date.now()}`;
  connections.set(connectionId, send);

  console.log(
    `🔔 Subscribed connection ${connectionId} (${connections.size}/${MAX_CONNECTIONS})`,
  );

  return () => {
    connections.delete(connectionId);
    console.log(
      `🔔 Unsubscribed connection ${connectionId} (${connections.size}/${MAX_CONNECTIONS})`,
    );
  };
}
