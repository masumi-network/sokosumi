// Imported by core-log-at-load.test.ts: logs while it loads, as a module
// whose top level reads the environment can.
import { emitCoreWarning } from "@/lib/evlog";
import { getEnvSecrets } from "@/lib/secret-redaction";

const [secret] = getEnvSecrets();

emitCoreWarning(
  { operation: "fixture_import" },
  {
    message: "Fixture logged while it loaded",
    why: "The fixture logs at import on purpose",
    cause: new Error(`token ${secret}`),
  },
);
