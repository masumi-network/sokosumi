import { ExampleOutput } from "@prisma/client";

import { ipfsUrlResolver } from "@/lib/ipfs";

export function getResolvedUrl(exampleOutput: ExampleOutput): string {
  return ipfsUrlResolver(exampleOutput.url);
}
