import { writeFileSync } from "node:fs";
import process from "node:process";
import { createInterface } from "node:readline";

// Prisma's generator protocol sends the full datamodel; the generated client
// only ships the metadata its runtime needs.
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  let result = null;
  if (method === "getManifest") {
    result = { manifest: { defaultOutput: "./crossing-keys-dmmf" } };
  } else if (method === "generate") {
    writeFileSync(
      params.generator.output.value,
      JSON.stringify(params.dmmf.datamodel.models),
    );
  } else {
    throw new Error(`Unexpected Prisma generator method: ${method}`);
  }
  process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
