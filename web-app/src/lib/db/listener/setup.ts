import "server-only";

import pLimit from "p-limit";
import pTimeout from "p-timeout";
import { Client } from "pg";

import { getEnvSecrets } from "@/config/env.secrets";

// Connection management with limits and health checks
const MAX_CONNECTIONS = 0; // Adjust based on your server capacity
const CONNECTION_TIMEOUT = 30000; // 30 seconds
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const SEND_TIMEOUT = 5000; // 5 seconds timeout for sending to each connection
const BROADCAST_CONCURRENCY = 50; // Process 50 connections concurrently

const PG_RECONNECT_INTERVAL = 5000; // 5 seconds

interface ConnectionInfo {
  send: (data: string) => void;
  lastActivity: number;
  userId: string;
  isAlive: boolean;
}

let pgClient: Client | null = null;
const connections = new Map<string, ConnectionInfo>();
let healthCheckInterval: NodeJS.Timeout | null = null;

export async function initJobStatusListener() {
  if (pgClient) return;

  pgClient = new Client({
    connectionString: getEnvSecrets().DATABASE_URL,
  });

  await pgClient.connect();
  await pgClient.query("LISTEN job_status_updated");

  pgClient.on("notification", async (msg) => {
    const { channel, payload } = msg;
    if (channel === "job_status_updated" && !!payload) {
      await broadcastToConnections(payload);
    }
  });

  pgClient.on("error", (err) => {
    console.error("PostgreSQL listener error:", err);
    // Attempt to reconnect
    setTimeout(() => {
      pgClient = null;
      initJobStatusListener();
    }, PG_RECONNECT_INTERVAL);
  });

  // Start health check interval
  healthCheckInterval ??= setInterval(
    cleanupDeadConnections,
    HEALTH_CHECK_INTERVAL,
  );

  console.log("🔔 Listening to job_status_updated channel");

  return;
}

async function broadcastToConnections(payload: string): Promise<void> {
  const startTime = Date.now();
  const deadConnectionIds: string[] = [];

  // Create a concurrency limiter
  const limit = pLimit(BROADCAST_CONCURRENCY);

  // Get all active connections
  const activeConnections = Array.from(connections.entries()).filter(
    ([_, connection]) => connection.isAlive,
  );

  // Create tasks for each connection with controlled concurrency
  const tasks = activeConnections.map(([connectionId, connection]) =>
    limit(async () => {
      try {
        // Update last activity
        connection.lastActivity = Date.now();

        // Send payload with timeout
        await pTimeout(sendToConnection(connection.send, payload), {
          milliseconds: SEND_TIMEOUT,
        });
      } catch (error) {
        console.error(`Failed to send to connection ${connectionId}:`, error);
        deadConnectionIds.push(connectionId);
      }
    }),
  );

  // Execute all tasks with controlled concurrency
  try {
    await Promise.allSettled(tasks);
  } catch (error) {
    console.error("Broadcast error:", error);
  }

  // Clean up dead connections
  deadConnectionIds.forEach(connections.delete);

  const duration = Date.now() - startTime;
  if (activeConnections.length > 100) {
    console.log(
      `🔔 Broadcast to ${activeConnections.length} connections in ${duration}ms (${deadConnectionIds.length} dead, concurrency: ${BROADCAST_CONCURRENCY})`,
    );
  }

  if (deadConnectionIds.length > 0) {
    console.log(
      `🔔 Cleaned up ${deadConnectionIds.length} dead connections during broadcast`,
    );
  }
}

async function sendToConnection(
  send: (data: string) => void,
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

function cleanupDeadConnections(): void {
  const now = Date.now();
  const deadConnectionIds: string[] = [];

  for (const [connectionId, connection] of connections) {
    // Remove connections that haven't been active for too long
    if (now - connection.lastActivity > CONNECTION_TIMEOUT) {
      deadConnectionIds.push(connectionId);
    }
  }

  deadConnectionIds.forEach(connections.delete);

  if (deadConnectionIds.length > 0) {
    console.log(
      `🔔 Cleaned up ${deadConnectionIds.length} dead connections during health check`,
    );
  }
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
  connections.set(connectionId, {
    send,
    lastActivity: Date.now(),
    userId,
    isAlive: true,
  });

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
