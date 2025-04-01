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

export async function main(_args: unknown): Promise<FunctionResponse> {
  try {
    // Get API endpoint from environment variable
    const apiUrlString = process.env.SOKOSUMI_API_URL;
    const adminKey = process.env.ADMIN_KEY;
    if (!apiUrlString) {
      return {
        statusCode: 400,
        body: { error: "SOKOSUMI_API_URL environment variable not set" },
      };
    }
    const apiUrl = new URL("/api/cron/job-sync", apiUrlString);

    // Make the API call
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "admin-api-key": `${adminKey}`,
      },
    });
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: { error: `API call failed: ${response.statusText}` },
      };
    }
    const data = await response.json();

    return {
      statusCode: 200,
      body: {
        message: "API call successful",
        timestamp: new Date().toISOString(),
        response: data,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
}
