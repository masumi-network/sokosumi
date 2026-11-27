/**
 * The Cuso path test: fictional brands through Cuso's five stages (Brand
 * Brain, strategy, month, mid-month change, "what is working?"), each on a
 * fresh eval lane, in this process. See docs/evals/benchmark/cmo-path.md.
 *
 *   pnpm exec tsx --env-file=.env scripts/cmo-path.mts --plan --brands tallyform,crumb-and-kettle --mode both --json-out out.json
 *   pnpm exec tsx --env-file=.env scripts/cmo-path.mts --plan --holdout HELD.ts --mode real --json-out held.json
 *
 * --mode noop hires a Cuso nobody briefs: every stage must fail. The outbound
 * guard records every call outside the plan, Jev and this machine; a run with
 * any such call, or without the guard, fails its audit.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    plan: { type: "boolean", default: false },
    brands: { type: "string" },
    mode: { type: "string", default: "both" },
    /** A module exporting CMO_PATH_HELDOUT_BRANDS, kept outside the repository. */
    holdout: { type: "string" },
    "json-out": { type: "string" },
  },
});

if (values.plan) {
  process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "1";
  process.env.SOKO_BOT_PLAN_REAL_JEV ??= "1";
}
process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";
// The path lanes' owners sign up as evals+cmopath<lane>@sokosumi.com.
process.env.CMO_HIRE_ALLOWLIST = [
  process.env.CMO_HIRE_ALLOWLIST,
  "@sokosumi.com",
]
  .filter(Boolean)
  .join(",");

// The guard ships with #8432; a base without it fails the audit, never passes it.
const OUTBOUND_GUARD = "@/lib/evals/outbound-guard";
const guard = (await import(OUTBOUND_GUARD).catch(() => null)) as {
  installEvalOutboundGuard(mode: "enforce", logFile?: string): void;
  outboundAttempts(): readonly { host: string; via: string }[];
} | null;
guard?.installEvalOutboundGuard("enforce", process.env.EVAL_OUTBOUND_LOG);

const { CMO_PATH_DEV_BRANDS } = await import(
  "@/services/evals/cmo-path/brands"
);
const { registerCmoPathBrands } = await import(
  "@/services/evals/cmo-path/sites"
);
const { runCmoPathBrand } = await import("@/services/evals/cmo-path/stages");
const { default: prisma } = await import("@/lib/db/prisma");

const held = values.holdout
  ? (
      (await import(values.holdout)) as {
        CMO_PATH_HELDOUT_BRANDS: typeof CMO_PATH_DEV_BRANDS;
      }
    ).CMO_PATH_HELDOUT_BRANDS
  : [];
registerCmoPathBrands(held);
const wanted = values.brands?.split(",").map((id) => id.trim());
const brands = [...CMO_PATH_DEV_BRANDS, ...held].filter(
  (brand) => !wanted || wanted.includes(brand.id),
);
const heldIds = new Set(held.map((brand) => brand.id));
const modes =
  values.mode === "both"
    ? (["noop", "real"] as const)
    : [values.mode as "real" | "noop"];

const results = [];
for (const brand of brands)
  for (const mode of modes) {
    const startedAt = Date.now();
    const result = await runCmoPathBrand(brand, mode);
    results.push({
      ...result,
      minutes: Math.round((Date.now() - startedAt) / 60_000),
    });
    // The held-out brands show as counts only.
    const name = heldIds.has(brand.id) ? "held-out" : brand.id;
    console.log(
      `${name} ${mode}: ${result.stages.map((s) => `${s.stage} ${s.pass ? "PASS" : "FAIL"} (${s.checks.filter((c) => c.pass).length}/${s.checks.length})`).join(" · ")}`,
    );
  }

const attempts = guard ? guard.outboundAttempts() : null;
const audit = {
  guard: guard ? "enforce" : "unavailable",
  externalCalls: attempts?.length ?? null,
  hosts: [...new Set((attempts ?? []).map((attempt) => attempt.host))],
  pass: attempts !== null && attempts.length === 0,
};
console.log(
  `Outbound audit: ${audit.pass ? "PASS" : "FAIL"} (${audit.guard}, ${audit.externalCalls ?? "?"} external calls${audit.hosts.length ? `: ${audit.hosts.join(", ")}` : ""})`,
);
const noopPasses = results
  .filter((r) => r.mode === "noop")
  .flatMap((r) =>
    r.stages.filter((s) => s.pass).map((s) => `${r.brand}/${s.stage}`),
  );
console.log(
  `Do-nothing: ${noopPasses.length === 0 ? "PASS (every stage failed)" : `FAIL (passed: ${noopPasses.join(", ")})`}`,
);
if (values["json-out"])
  await writeFile(
    values["json-out"],
    JSON.stringify({ audit, results }, null, 2),
  );
await prisma.$disconnect();
process.exit(audit.pass && noopPasses.length === 0 ? 0 : 1);
