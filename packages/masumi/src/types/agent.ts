/**
 * Minimal Agent interface for agent client operations.
 * This allows the client to work without depending on the database package.
 */
export interface Agent {
  id: string;
  name: string;
  blockchainIdentifier: string;
  apiBaseUrl: string;
  overrideApiBaseUrl?: string | null;
}
