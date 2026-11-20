// Run by env-startup.test.ts in a child process: importing the environment
// module alone has to start Core's logger, with its redaction.
import "@/config/env";
import { emitCoreWarning } from "@/lib/evlog";

emitCoreWarning(
  { operation: "startup_probe" },
  {
    message: "Startup probe",
    cause: new Error(`probe ${process.env.PROBE_SECRET}`),
  },
);
