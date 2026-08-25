import { defaultBackend, defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

/**
 * Hosted Vercel deployments resolve to Vercel Sandbox through
 * `defaultBackend()`. Set `SOKO_BOT_SANDBOX_BACKEND=vercel` in local dev to
 * pin hosted sandboxes there too (needs pulled Vercel credentials).
 */
const backend =
  process.env.SOKO_BOT_SANDBOX_BACKEND === "vercel"
    ? vercel({ networkPolicy: "deny-all" })
    : defaultBackend({
        docker: { networkPolicy: "deny-all" },
        microsandbox: { networkPolicy: "deny-all" },
        vercel: { networkPolicy: "deny-all" },
      });

export default defineSandbox({ backend });
