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
async function callApi(apiUrlString: string, endpoint: string) {
  const url = new URL(endpoint, apiUrlString);
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
    const apiUrlString = process.env.SOKOSUMI_API_URL;

    if (!apiUrlString) {
      return {
        statusCode: 400,
        body: { error: "SOKOSUMI_API_URL environment variable not set" },
      };
    }

    // Agents and Jobs API calls in parallel
    let agentsData, jobsData;
    try {
      [agentsData, jobsData] = await Promise.all([
        callApi(apiUrlString, "/sync/agents"),
        callApi(apiUrlString, "/sync/jobs"),
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
