import "server-only";

import pLimit from "p-limit";
import pTimeout from "p-timeout";
import { Client, Notification } from "pg";

import { getEnvSecrets } from "@/config/env.secrets";

// Connection management with limits and health checks
const MAX_CONNECTIONS = 10000; // Adjust based on your server capacity
const SEND_TIMEOUT = 5000; // 5 seconds timeout for sending to each connection
const BROADCAST_CONCURRENCY = 50; // Process 50 connections concurrently
const PG_RECONNECT_INTERVAL = 5000; // 5 seconds

// keep alive interval for SSE connection
let keepAliveInterval: NodeJS.Timeout | null = null;
const KEEP_ALIVE_INTERVAL = 10000; // 10 seconds

type Connection = (payload: string) => void;

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
    () =>
      broadcastToConnections(JSON.stringify({ now: new Date().toISOString() })),
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

async function broadcastToConnections(payload: string): Promise<void> {
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
          // Send payload with timeout
          await pTimeout(sendToConnection(connection, payload), {
            milliseconds: SEND_TIMEOUT,
          });
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
    console.error("Broadcast error:", error);
  }

  const successfulConnections = results.filter(
    (result) => result.status === "fulfilled",
  );

  // Clean up dead connections
  deadConnectionIds.forEach((id) => connections.delete(id));

  const duration = Date.now() - startTime;
  console.log(
    `🔔 Broadcast to ${successfulConnections.length} connections in ${duration}ms (${deadConnectionIds.length} dead)`,
  );
}

async function sendToConnection(
  send: Connection,
  payload: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      send(payload);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

export function subscribeConnection(
  send: (data: string) => void,
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
