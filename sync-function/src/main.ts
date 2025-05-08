/* eslint-disable no-restricted-properties */
interface FunctionResponse {
  statusCode: number;
  body: {
    message?: string;
    timestamp?: string;
    response?: unknown;
    error?: string;
  };
}

// Generic function for API calls
async function callApi(baseUrl: string, endpoint: string) {
  const url = new URL(endpoint, baseUrl);
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    throw new Error("ADMIN_KEY environment variable not set");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "admin-api-key": `${adminKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`${endpoint} API call failed: ${response.statusText}`);
  }
  return response.json();
}

export async function main(_args: unknown): Promise<FunctionResponse> {
  try {
    // Get API endpoint from environment variable
    const baseUrl = process.env.SOKOSUMI_URL;
    if (!baseUrl) {
      return {
        statusCode: 400,
        body: { error: "SOKOSUMI_URL environment variable not set" },
      };
    }

    // Agents and Jobs API calls in parallel
    let agentsData, jobsData;
    try {
      [agentsData, jobsData] = await Promise.all([
        callApi(baseUrl, "api/sync/agents"),
        callApi(baseUrl, "api/sync/jobs"),
      ]);
    } catch (err) {
      return {
        statusCode: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }

    return {
      statusCode: 200,
      body: {
        message: "API call successful",
        timestamp: new Date().toISOString(),
        response: {
          agents: agentsData,
          jobs: jobsData,
        },
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: `Unexpected error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
    };
  }
}
