import { ipfsUrlResolver } from "@/lib/ipfs";
import { ExampleOutput } from "@/prisma/generated/client";

export function getResolvedUrl(exampleOutput: ExampleOutput): string {
  return ipfsUrlResolver(exampleOutput.url);
}
