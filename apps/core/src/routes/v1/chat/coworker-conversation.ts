const CREATE_CONVERSATION_TIMEOUT_MS = 25_000;

export interface CreateCoworkerConversationOptions {
  responsesApiBaseUrl: string;
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  coworkerSlug: string;
  sokosumiConversationId: string;
}

export async function createCoworkerConversation(
  options: CreateCoworkerConversationOptions,
): Promise<{ id: string }> {
  const baseUrl = options.responsesApiBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Responses API base URL is required");
  }
  if (!options.coworkerSlug?.trim()) {
    throw new Error("Coworker slug is required");
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/conversations`;
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sokosumi-User-Id": options.sokosumiUserId,
    "X-Coworker-Slug": options.coworkerSlug,
  };
  if (options.sokosumiOrganizationId) {
    requestHeaders["X-Sokosumi-Organization-Id"] =
      options.sokosumiOrganizationId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      metadata: {
        sokosumi_user_id: options.sokosumiUserId,
        sokosumi_organization_id: options.sokosumiOrganizationId,
        coworker_slug: options.coworkerSlug,
        sokosumi_conversation_id: options.sokosumiConversationId,
      },
    }),
    signal: AbortSignal.timeout(CREATE_CONVERSATION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Conversations API error: ${response.status} ${errorText}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (parseErr) {
    throw new Error(
      `Conversations API invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    );
  }

  const bodyObj = body as Record<string, unknown>;
  const data = bodyObj?.data ?? bodyObj;
  const inner = (data as Record<string, unknown>) ?? {};
  const id =
    typeof inner?.id === "string"
      ? inner.id
      : typeof bodyObj?.id === "string"
        ? bodyObj.id
        : null;

  if (!id) {
    throw new Error("Conversations API returned no conversation id");
  }

  return { id };
}
