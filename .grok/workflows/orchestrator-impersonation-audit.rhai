let meta = #{
    name: "orchestrator-impersonation-audit",
    description: "Audit that orchestrator service token + X-Context-* headers can access every user-available Core API surface (flag unexpected session-only gates)",
    when_to_use: "Verify Hermes orchestrator impersonation parity: service token + context headers should reach user-scoped endpoints. Invoke as /orchestrator-impersonation-audit",
    phases: [
        #{ title: "Map auth primitives", detail: "requireUserContext vs requireUserAuthContext vs requireOwnerUserContext" },
        #{ title: "Inventory domains", detail: "parallel scan of Core v1 route trees by domain" },
        #{ title: "Cross-check policy", detail: "docs + intentional exclusions vs code" },
        #{ title: "Verify gaps", detail: "adversarial check that each gap is real and unexpected" },
        #{ title: "Report", detail: "markdown audit report with pass/fail and file:line evidence" },
    ],
};

let primitives_schema = #{
    "type": "object",
    "required": ["summary", "primitives"],
    "properties": #{
        "summary": #{ "type": "string" },
        "primitives": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["name", "allows_orchestrator_with_context", "file", "notes"],
                "properties": #{
                    "name": #{ "type": "string" },
                    "allows_orchestrator_with_context": #{ "type": "boolean" },
                    "file": #{ "type": "string" },
                    "notes": #{ "type": "string" },
                },
            },
        },
    },
};

let domain_schema = #{
    "type": "object",
    "required": ["domain", "endpoints", "unexpected_denials", "intentional_exclusions", "notes"],
    "properties": #{
        "domain": #{ "type": "string" },
        "endpoints": #{
            "type": "array",
            "maxItems": 40,
            "items": #{
                "type": "object",
                "required": ["method_path", "file", "guard", "user_accessible", "orchestrator_with_context", "classification"],
                "properties": #{
                    "method_path": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "guard": #{ "type": "string" },
                    "user_accessible": #{ "type": "boolean" },
                    "orchestrator_with_context": #{ "type": "string", "enum": ["allowed", "denied", "unknown", "n_a"] },
                    "classification": #{
                        "type": "string",
                        "enum": ["parity_ok", "intentional_deny", "unexpected_deny", "orchestrator_only", "non_user", "needs_review"],
                    },
                },
            },
        },
        "unexpected_denials": #{
            "type": "array",
            "maxItems": 20,
            "items": #{
                "type": "object",
                "required": ["method_path", "file", "guard", "why_unexpected"],
                "properties": #{
                    "method_path": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "guard": #{ "type": "string" },
                    "why_unexpected": #{ "type": "string" },
                },
            },
        },
        "intentional_exclusions": #{
            "type": "array",
            "maxItems": 15,
            "items": #{
                "type": "object",
                "required": ["method_path", "file", "reason"],
                "properties": #{
                    "method_path": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "reason": #{ "type": "string" },
                },
            },
        },
        "notes": #{ "type": "string" },
    },
};

let policy_schema = #{
    "type": "object",
    "required": ["policy_summary", "documented_exclusions", "gaps_vs_docs"],
    "properties": #{
        "policy_summary": #{ "type": "string" },
        "documented_exclusions": #{
            "type": "array",
            "maxItems": 20,
            "items": #{
                "type": "object",
                "required": ["surface", "source", "expected"],
                "properties": #{
                    "surface": #{ "type": "string" },
                    "source": #{ "type": "string" },
                    "expected": #{ "type": "string" },
                },
            },
        },
        "gaps_vs_docs": #{
            "type": "array",
            "maxItems": 15,
            "items": #{
                "type": "object",
                "required": ["issue", "evidence"],
                "properties": #{
                    "issue": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                },
            },
        },
    },
};

let gap_verdict_schema = #{
    "type": "object",
    "required": ["real", "severity", "reason", "evidence", "fix_suggestion"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "severity": #{ "type": "string", "enum": ["blocker", "major", "minor", "nit", "invalid"] },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "fix_suggestion": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["markdown", "verdict", "unexpected_count", "intentional_count"],
    "properties": #{
        "markdown": #{ "type": "string" },
        "verdict": #{ "type": "string", "enum": ["pass", "pass_with_gaps", "fail"] },
        "unexpected_count": #{ "type": "integer" },
        "intentional_count": #{ "type": "integer" },
    },
};

// Optional args.root defaults to monorepo Core routes.
let root = "apps/core/src";
if args != () && args.root != () {
    root = args.root;
}

// ---------------------------------------------------------------------------
// Phase 1: Map auth primitives (single agent — foundational)
// ---------------------------------------------------------------------------
phase("Map auth primitives");

let prim_prompt = "";
prim_prompt += "You audit Sokosumi Core orchestrator impersonation auth primitives.\n";
prim_prompt += "Repo root is the workspace. Focus under: " + root + "\n\n";
prim_prompt += "MUST use tools (grep, read_file, list_dir). Do not answer from memory.\n\n";
prim_prompt += "Read and summarize these files thoroughly:\n";
prim_prompt += "1. apps/core/src/middleware/auth.ts — requireUserContext, requireUserAuthContext,\n";
prim_prompt += "   requireOwnerUserContext, requireOrchestratorAuthContext,\n";
prim_prompt += "   requireAdminAuthContext, isOrchestratorAuthContext, UserContext type.\n";
prim_prompt += "2. apps/core/src/middleware/coworker-context.ts — X-Context-User-Id / X-Context-Organization-Id\n";
prim_prompt += "   binding for coworker AND orchestrator; orchestratorId binding.\n";
prim_prompt += "3. apps/core/src/lib/orchestrator-service-token.ts\n";
prim_prompt += "4. apps/core/src/middleware/workspace.ts if present\n";
prim_prompt += "5. apps/core/src/routes/v1/users/user-path-access.ts and user-route-context.ts\n\n";
prim_prompt += "For each primitive, set allows_orchestrator_with_context=true only if an actor with\n";
prim_prompt += "actor=orchestrator AND context.userId set can pass that guard.\n";
prim_prompt += "requireUserAuthContext must be false (session/API-key user only).\n";
prim_prompt += "requireUserContext and requireOwnerUserContext must be true for contextual orchestrator.\n\n";
prim_prompt += "Return structured primitives list with exact file paths.\n";
prim_prompt += "Empty primitives only if you grepped and the files are missing.\n";

let prim = agent(prim_prompt, #{
    label: "auth-primitives",
    capability_mode: "read-only",
    output_schema: primitives_schema,
});

if prim == () || !prim.success || prim.output.primitives == () {
    pause("infra", "Auth primitives mapper failed — resume to retry.");
}

log("Auth primitives mapped: " + prim.output.primitives.len().to_string());

// ---------------------------------------------------------------------------
// Phase 2: Inventory route domains in parallel
// ---------------------------------------------------------------------------
phase("Inventory domains");

// Domains that should be user-accessible (and thus candidates for orchestrator parity).
// admin/enterprise intentionally non-user for this audit (admin role).
// coworkers/me and orchestrators/me are actor-specific.
let domains = [
    #{ id: "tasks", path: "apps/core/src/routes/v1/tasks", focus: "task CRUD, events, schedule, share, workspace, links, jobs" },
    #{ id: "jobs", path: "apps/core/src/routes/v1/jobs", focus: "job list/detail, inputs, refund, share, workspace, files, events" },
    #{ id: "projects", path: "apps/core/src/routes/v1/projects", focus: "project CRUD, nested tasks/jobs" },
    #{ id: "users", path: "apps/core/src/routes/v1/users", focus: "/users/me and /users/{id} including credits, prefs, design-md, orgs, grants" },
    #{ id: "organizations", path: "apps/core/src/routes/v1/organizations", focus: "org detail, members, billing, seats, vendor-grants, design-md" },
    #{ id: "agents", path: "apps/core/src/routes/v1/agents", focus: "agent catalog, jobs, ratings, reviews/me" },
    #{ id: "conversations-chat", path: "apps/core/src/routes/v1/conversations and apps/core/src/routes/v1/chat", focus: "marketplace conversations + chat stream; orch+context should be parity_ok (acts as context user)" },
    #{ id: "notifications", path: "apps/core/src/routes/v1/notifications", focus: "list, read, unread-count" },
    #{ id: "checkout-products-coupons", path: "apps/core/src/routes/v1/checkout, products, coupons", focus: "billing checkout, products catalog, coupon claim" },
    #{ id: "workspaces-history-misc", path: "apps/core/src/routes/v1/workspaces, history, invitations, categories, share, hermes, developer, vendors, credit-costs", focus: "remaining user-facing mounts; hermes is user-session product surface" },
];

let domain_jobs = [];
for d in domains {
    let p = "";
    p += "You audit Core API route domain for orchestrator impersonation parity.\n";
    p += "Domain id: " + d.id + "\n";
    p += "Paths: " + d.path + "\n";
    p += "Focus: " + d.focus + "\n\n";
    p += "MUST use grep/read_file/list_dir on the actual route files. Never invent endpoints.\n\n";
    p += "Policy under test:\n";
    p += "- Orchestrator authenticates with ORCHESTRATOR_SERVICE_TOKEN (actor=orchestrator).\n";
    p += "- With X-Context-User-Id (+ optional X-Context-Organization-Id), Core binds workspace user.\n";
    p += "- requireUserContext / requireOwnerUserContext: ALLOW orchestrator+context.\n";
    p += "- requireUserAuthContext / requireAdminAuthContext: DENY orchestrator (session/API-key only).\n";
    p += "- requireCoworkerAuthContext / requireOrchestratorAuthContext: actor-specific (n_a for user parity).\n\n";
    p += "Documented intentional orchestrator denials (from docs/orchestrator/hermes-orchestrator-actor.md):\n";
    p += "- /v1/hermes/* product chat: user session only (orchestrator 403)\n";
    p += "- marketplace chat / conversations: ALLOW orch+context (parity_ok); bare orch denied\n";
    p += "- POST /v1/tasks/{id}/jobs: coworker only (orchestrator 403)\n";
    p += "Session-bound ops (PII, Stripe checkout, coupon claim, notifications) may use requireUserAuthContext\n";
    p += "by design — still list them as unexpected_deny IF they look like general user workspace APIs that\n";
    p += "Hermes would need, OR as intentional_exclusions if clearly session-bound billing/consent/PII.\n";
    p += "When unsure, use classification needs_review and put in unexpected_denials with why.\n\n";
    p += "Procedure:\n";
    p += "1. list_dir the domain path(s); find route handlers (get.ts, post.ts, patch.ts, put.ts, delete.ts).\n";
    p += "2. For each handler, grep which auth guard it imports/calls.\n";
    p += "3. Infer method_path from OpenAPI route registration (path + method) or folder structure.\n";
    p += "4. Classify each user-accessible endpoint:\n";
    p += "   - parity_ok: user can call AND orchestrator+context allowed\n";
    p += "   - intentional_deny: user can call, orchestrator denied, matches documented product rule\n";
    p += "   - unexpected_deny: user can call, orchestrator denied, NOT clearly session-only/product rule\n";
    p += "   - orchestrator_only / non_user: skip parity\n";
    p += "   - needs_review: ambiguous\n";
    p += "5. Populate unexpected_denials and intentional_exclusions arrays (may be empty after real search).\n";
    p += "6. Cap endpoints at 40; prefer mutations + high-traffic reads if over cap; note truncation in notes.\n\n";
    p += "Also check nearby *.test.ts for createOrchestratorContextApp / actor=orchestrator coverage.\n";
    p += "Put coverage gaps in notes only (not unexpected_denials unless the guard itself is wrong).\n";

    domain_jobs.push(#{
        prompt: p,
        label: "domain:" + d.id,
        capability_mode: "read-only",
        output_schema: domain_schema,
    });
}

let domain_results = parallel(domain_jobs);

let all_unexpected = [];
let all_intentional = [];
let domain_summaries = [];
let i = 0;
for r in domain_results {
    let domain_id = domains[i].id;
    if r == () || !r.success || r.output == () {
        log("Domain inventory failed: " + domain_id);
        domain_summaries.push(#{
            domain: domain_id,
            status: "failed",
            unexpected: 0,
            intentional: 0,
        });
    } else {
        let out = r.output;
        let u_count = 0;
        let int_count = 0;
        if out.unexpected_denials != () {
            for g in out.unexpected_denials {
                all_unexpected.push(#{
                    domain: domain_id,
                    method_path: g.method_path,
                    file: g.file,
                    guard: g.guard,
                    why_unexpected: g.why_unexpected,
                });
                u_count += 1;
            }
        }
        if out.intentional_exclusions != () {
            for e in out.intentional_exclusions {
                all_intentional.push(#{
                    domain: domain_id,
                    method_path: e.method_path,
                    file: e.file,
                    reason: e.reason,
                });
                int_count += 1;
            }
        }
        domain_summaries.push(#{
            domain: domain_id,
            status: "ok",
            unexpected: u_count,
            intentional: int_count,
            notes: out.notes,
        });
        log(domain_id + ": unexpected=" + u_count.to_string() + " intentional=" + int_count.to_string());
    }
    i += 1;
}

// ---------------------------------------------------------------------------
// Phase 3: Cross-check documented policy
// ---------------------------------------------------------------------------
phase("Cross-check policy");

let policy_prompt = "";
policy_prompt += "Cross-check orchestrator impersonation policy docs against Core code.\n\n";
policy_prompt += "MUST read with tools:\n";
policy_prompt += "- docs/orchestrator/hermes-orchestrator-actor.md\n";
policy_prompt += "- docs/hermes-orchestrator-approve-overrides.md if present\n";
policy_prompt += "- apps/core/src/middleware/auth.ts (requireUserContext, requireUserAuthContext)\n";
policy_prompt += "- apps/core/src/routes/v1/auth-actor-guards.test.ts\n";
policy_prompt += "- grep requireUserAuthContext under apps/core/src/routes\n\n";
policy_prompt += "Summarize the product policy: when orchestrator+context may act as user.\n";
policy_prompt += "List documented exclusions with source path.\n";
policy_prompt += "gaps_vs_docs: places where code deny/allow diverges from docs, or docs are silent\n";
policy_prompt += "about a broad requireUserAuthContext class that blocks impersonation.\n";
policy_prompt += "Empty gaps_vs_docs is valid only after grepping and finding none.\n";

let policy = agent(policy_prompt, #{
    label: "policy-docs",
    capability_mode: "read-only",
    output_schema: policy_schema,
});

if policy == () || !policy.success {
    log("Policy cross-check agent failed; continuing with domain findings only");
}

// ---------------------------------------------------------------------------
// Phase 4: Adversarial verify unexpected denials (cap)
// ---------------------------------------------------------------------------
phase("Verify gaps");

const MAX_VERIFY = 12;
let to_verify = [];
let vi = 0;
for g in all_unexpected {
    if vi < MAX_VERIFY {
        to_verify.push(g);
        vi += 1;
    }
}
if all_unexpected.len() > MAX_VERIFY {
    log("Truncated verification to " + MAX_VERIFY.to_string() + " of " + all_unexpected.len().to_string() + " gaps");
}

let confirmed_gaps = [];
let dismissed_gaps = [];

if to_verify.len() > 0 {
    let vjobs = [];
    for g in to_verify {
        let vp = "";
        vp += "Adversarially verify this claimed orchestrator impersonation gap.\n\n";
        vp += "Claimed gap:\n";
        vp += "- domain: " + g.domain + "\n";
        vp += "- endpoint: " + g.method_path + "\n";
        vp += "- file: " + g.file + "\n";
        vp += "- guard: " + g.guard + "\n";
        vp += "- why: " + g.why_unexpected + "\n\n";
        vp += "You MUST open the file and read the handler. Confirm:\n";
        vp += "1. A normal user session can access this endpoint.\n";
        vp += "2. An orchestrator with service token + X-Context-User-Id is rejected by this guard\n";
        vp += "   (or equivalent logic).\n";
        vp += "3. The denial is NOT justified by documented product rules in\n";
        vp += "   docs/orchestrator/hermes-orchestrator-actor.md (hermes product session-only,\n";
        vp += "   POST tasks/{id}/jobs coworker-only). Marketplace chat/conversations ALLOW orch+ctx.\n";
        vp += "4. If guard is requireUserAuthContext for clear session-bound billing/consent/PII,\n";
        vp += "   set real=false severity=invalid — intentional session-only, not a bug.\n";
        vp += "5. If Hermes/workspace orchestration would reasonably need this user surface,\n";
        vp += "   set real=true.\n\n";
        vp += "Set real=true only with concrete file evidence you read. Default real=false when unsure.\n";
        vp += "fix_suggestion: e.g. switch requireUserAuthContext → requireUserContext, or document exclusion.\n";

        vjobs.push(#{
            prompt: vp,
            label: "verify:" + g.domain,
            capability_mode: "read-only",
            output_schema: gap_verdict_schema,
        });
    }

    let verdicts = parallel(vjobs);
    let j = 0;
    for v in verdicts {
        let gap = to_verify[j];
        if v != () && v.success && v.output != () && v.output.real == true
            && v.output.evidence != () && v.output.evidence != "" {
            confirmed_gaps.push(#{
                domain: gap.domain,
                method_path: gap.method_path,
                file: gap.file,
                guard: gap.guard,
                severity: v.output.severity,
                reason: v.output.reason,
                evidence: v.output.evidence,
                fix_suggestion: v.output.fix_suggestion,
            });
        } else {
            let why = "unverified or not real";
            if v != () && v.success && v.output != () && v.output.reason != () {
                why = v.output.reason;
            }
            dismissed_gaps.push(#{
                domain: gap.domain,
                method_path: gap.method_path,
                file: gap.file,
                reason: why,
            });
        }
        j += 1;
    }
} else {
    log("No unexpected denials claimed by domain scanners");
}

log("Confirmed gaps: " + confirmed_gaps.len().to_string()
    + " / claimed: " + all_unexpected.len().to_string()
    + " (verified up to " + to_verify.len().to_string() + ")");

// ---------------------------------------------------------------------------
// Phase 5: Synthesize report
// ---------------------------------------------------------------------------
phase("Report");

let payload = #{
    primitives_summary: if prim.success { prim.output.summary } else { "unavailable" },
    primitives: if prim.success { prim.output.primitives } else { [] },
    domain_summaries: domain_summaries,
    intentional_exclusions: all_intentional,
    claimed_unexpected: all_unexpected,
    confirmed_gaps: confirmed_gaps,
    dismissed_gaps: dismissed_gaps,
    policy: if policy != () && policy.success { policy.output } else { () },
};

let payload_json = json_encode(payload);

let report_prompt = "";
report_prompt += "Write a markdown audit report for orchestrator impersonation parity.\n\n";
report_prompt += "INVARIANT under test:\n";
report_prompt += "An orchestrator authenticated with ORCHESTRATOR_SERVICE_TOKEN that sends\n";
report_prompt += "X-Context-User-Id / X-Context-Organization-Id must be able to call every Core API\n";
report_prompt += "endpoint available to that user, except documented intentional exclusions\n";
report_prompt += "(Hermes product /v1/hermes/*, coworker-only POST /v1/tasks/{id}/jobs) and\n";
report_prompt += "clearly session-bound surfaces (Stripe checkout, OAuth consent, admin).\n";
report_prompt += "Marketplace chat/conversations SHOULD allow orch+context.\n\n";
report_prompt += "Use ONLY this JSON evidence (do not invent endpoints):\n";
report_prompt += payload_json + "\n\n";
report_prompt += "Report structure (markdown):\n";
report_prompt += "# Orchestrator impersonation audit\n";
report_prompt += "## Verdict (pass | pass_with_gaps | fail)\n";
report_prompt += "## Auth primitives (table)\n";
report_prompt += "## Domain coverage summary\n";
report_prompt += "## Confirmed unexpected denials (fix these — file, guard, evidence, suggestion)\n";
report_prompt += "## Intentional exclusions (OK)\n";
report_prompt += "## Dismissed claims\n";
report_prompt += "## Policy / docs alignment\n";
report_prompt += "## Recommended next steps (tests: auth-actor-guards style createOrchestratorContextApp)\n\n";
report_prompt += "verdict=fail if any confirmed gap has severity blocker or major.\n";
report_prompt += "verdict=pass_with_gaps if only minor/nit confirmed gaps or needs_review leftovers.\n";
report_prompt += "verdict=pass if confirmed_gaps empty and domains mostly ok.\n";
report_prompt += "unexpected_count = confirmed_gaps length. intentional_count = intentional_exclusions length.\n";
report_prompt += "Keep markdown complete but concise; every confirmed gap must cite file path.\n";

let report = agent(report_prompt, #{
    label: "synthesize-report",
    capability_mode: "read-only",
    output_schema: report_schema,
});

if report == () || !report.success || report.output.markdown == () {
    // Fallback minimal report if synthesizer fails
    let fallback = "# Orchestrator impersonation audit\n\n";
    fallback += "Synthesizer failed. Raw counts:\n";
    fallback += "- claimed unexpected: " + all_unexpected.len().to_string() + "\n";
    fallback += "- confirmed gaps: " + confirmed_gaps.len().to_string() + "\n";
    fallback += "- intentional: " + all_intentional.len().to_string() + "\n";
    let path = write_scratch_file("orchestrator-impersonation-audit.md", fallback);
    complete(#{
        path: path,
        verdict: "fail",
        unexpected_count: confirmed_gaps.len(),
        intentional_count: all_intentional.len(),
        summary: "Report synthesizer failed; raw counts only",
    });
}

let md = report.output.markdown;
let path = write_scratch_file("orchestrator-impersonation-audit.md", md);

complete(#{
    path: path,
    verdict: report.output.verdict,
    unexpected_count: report.output.unexpected_count,
    intentional_count: report.output.intentional_count,
    summary: "Orchestrator impersonation audit: " + report.output.verdict
        + " (" + report.output.unexpected_count.to_string() + " confirmed unexpected denials)",
});
