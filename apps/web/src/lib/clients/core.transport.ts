import type { Client } from "@/lib/clients/generated/core/client";

export interface CoreTransportAdapter {
  createGeneratedClient(): Promise<Client>;
}

export async function getCoreTransportAdapter(): Promise<CoreTransportAdapter> {
  if (typeof window !== "undefined") {
    const { coreBrowserTransportAdapter } = await import(
      "./core.transport.browser"
    );
    return coreBrowserTransportAdapter;
  }

  const { coreServerTransportAdapter } = await import("./core.transport.server");
  return coreServerTransportAdapter;
}
