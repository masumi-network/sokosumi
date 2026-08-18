export interface OauthClientInput {
  id: string;
  type?: string | null;
  public?: boolean | null;
}

export interface ReadyOauthClientMapping {
  status: "ready";
  id: string;
  applicationType: "web" | "native";
  tokenEndpointAuthMethod: "none" | "client_secret_basic";
  clientCredentialsScopes: [];
  clientDiscoveryId: null;
}

export interface UnmappedOauthClientMapping {
  status: "unmapped";
  id: string;
  reason: "oauth-client-type-needs-review";
  type: string | null;
}

export type OauthClientMapping =
  | ReadyOauthClientMapping
  | UnmappedOauthClientMapping;

export function mapOauthClientForBetterAuth17(
  client: OauthClientInput,
): OauthClientMapping {
  if (client.type === "web" || client.type === "native") {
    return {
      status: "ready",
      id: client.id,
      applicationType: client.type,
      tokenEndpointAuthMethod: client.public ? "none" : "client_secret_basic",
      clientCredentialsScopes: [],
      clientDiscoveryId: null,
    };
  }

  return {
    status: "unmapped",
    id: client.id,
    reason: "oauth-client-type-needs-review",
    type: client.type ?? null,
  };
}
