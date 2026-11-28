import {
  createPaymentClient,
  createRegistryClient,
} from "@sokosumi/masumi/clients";
import { getEnv } from "@/config/env";
import { masumiConfiguration } from "@/config/masumi";
import { type Network, requireNetworkOn } from "@/lib/network";

function createClients(network: Network) {
  const config = masumiConfiguration(getEnv(), network);
  if (config.missing) {
    throw new Error(
      `Masumi configuration for ${network} is incomplete: ${config.missing.join(", ")}`,
    );
  }
  const rail = network === "mainnet" ? "Mainnet" : "Preprod";
  const payment = createPaymentClient(
    rail,
    config.paymentUrl,
    config.paymentKey,
  );
  return {
    payment: { ...payment, network },
    registry: {
      ...createRegistryClient(rail, config.registryUrl, config.registryKey),
      network,
    },
  } as const;
}

const clients = new Map<Network, ReturnType<typeof createClients>>();

export function masumiClients(network: Network) {
  requireNetworkOn(network);
  const existing = clients.get(network);
  if (existing) return existing;
  const pair = createClients(network);
  clients.set(network, pair);
  return pair;
}

export function requireSameMasumiNetwork(
  scope: { readonly network: Network },
  client: { readonly network: Network },
) {
  if (scope.network !== client.network) {
    throw new Error("Masumi client does not belong to this Network scope");
  }
}
