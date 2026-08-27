export const CORE_REQUEST_ID_HEADER = "x-request-id";

const instrumentedClients = new WeakSet<object>();

interface CoreRequestInterceptable {
  interceptors?: {
    request?: {
      use?: (
        fn: (options: { headers: Headers }) => void | Promise<void>,
      ) => unknown;
    };
  };
}

export function createCoreRequestId(): string {
  return crypto.randomUUID();
}

export function applyCoreRequestIdHeader(headers: Headers): string {
  const existing = headers.get(CORE_REQUEST_ID_HEADER);
  if (existing) {
    return existing;
  }

  const requestId = createCoreRequestId();
  headers.set(CORE_REQUEST_ID_HEADER, requestId);
  return requestId;
}

export function attachCoreRequestIdInterceptor<T extends object>(client: T): T {
  const requestInterceptors = (client as CoreRequestInterceptable).interceptors
    ?.request;

  if (
    !requestInterceptors ||
    typeof requestInterceptors.use !== "function" ||
    instrumentedClients.has(client)
  ) {
    return client;
  }

  instrumentedClients.add(client);
  requestInterceptors.use((options) => {
    applyCoreRequestIdHeader(options.headers);
  });

  return client;
}

export function extractCoreRequestId(params: {
  error?: unknown;
  response?: Response;
}): string | undefined {
  const header = params.response?.headers.get(CORE_REQUEST_ID_HEADER);
  if (header) {
    return header;
  }

  if (
    params.error &&
    typeof params.error === "object" &&
    "meta" in params.error
  ) {
    const meta = (params.error as { meta?: { requestId?: unknown } }).meta;
    if (typeof meta?.requestId === "string" && meta.requestId.length > 0) {
      return meta.requestId;
    }
  }

  return undefined;
}
