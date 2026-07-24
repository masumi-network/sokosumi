let meta = #{
    name: "review-pr-features",
    description: "Review each discrete feature in a PR in parallel, verify findings, synthesize report",
    when_to_use: "PR or branch with multiple distinct features that need independent review",
    phases: [
        #{ title: "Review features", detail: "one read-only reviewer per feature" },
        #{ title: "Verify findings", detail: "adversarial check on each reported issue" },
        #{ title: "Synthesize", detail: "write a single markdown report" },
    ],
};

let feature_schema = #{
    "type": "object",
    "required": ["feature", "verdict", "summary", "findings"],
    "properties": #{
        "feature": #{ "type": "string" },
        "verdict": #{ "type": "string", "enum": ["pass", "pass_with_nits", "fail"] },
        "summary": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 6,
            "items": #{
                "type": "object",
                "required": ["severity", "file", "issue", "suggestion"],
                "properties": #{
                    "severity": #{ "type": "string", "enum": ["blocker", "major", "minor", "nit"] },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "suggestion": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "severity", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "severity": #{ "type": "string", "enum": ["blocker", "major", "minor", "nit", "invalid"] },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["markdown"],
    "properties": #{
        "markdown": #{ "type": "string" },
    },
};

// --- args ---
let base = if args == () { () } else { args.base };
let head = if args == () { () } else { args.head };
if base == () { base = "origin/main"; }
if head == () { head = "HEAD"; }

// Features default to this PR's contract; override via args.features
// as an array of { id, title, focus } maps.
let features = if args != () && args.features != () { args.features } else { [
    #{
        id: "verbatim-steps",
        title: "Verbatim step render from orchestrator payload",
        focus: "step.label + step.status rendered straight from polled payload; rows keyed by step.id; hardcoded 6-step live skeleton removed (preview mock may remain); dynamic subset and mid-run relabel (e.g. inbox_scan) must work without local templates.",
    },
    #{
        id: "warming-monotonic",
        title: "Pre-first-poll warming line + monotonic step retention",
        focus: "Before first non-empty steps poll: single neutral Warming things up line + spinner, not fabricated list. Once steps arrived, later step-less 200 must keep last non-empty list (monotonic checklist, never bounce back to warming).",
    },
    #{
        id: "eta-display",
        title: "Coarse ETA display + empty-steps zero-ETA gate",
        focus: "etaSeconds shown as minute-granular ceil(eta/60) next to elapsed; under 30s show Almost done; deliberately not per-second countdown. When steps empty (machine-boot window), do NOT show fabricated zero ETA / Almost done; treat step-less poll as no ETA info and retain last real figure.",
    },
    #{
        id: "skipped-styling",
        title: "Skipped rows without line-through",
        focus: "Skipped rows must not use line-through — labels are explanation-style (Inbox not connected); dash glyph + muted colour already communicate skipped. Check classNames and status branch.",
    },
    #{
        id: "i18n",
        title: "i18n key swap (etaMinutesLabel / remove etaLabel)",
        focus: "en gains etaMinutesLabel ICU key; orphaned etaLabel removed from en, other catalogs, and hermes-translations override packs so sync script cannot resurrect it. No broken t() keys in component.",
    },
    #{
        id: "tests",
        title: "Onboarding progress test coverage",
        focus: "Tests for: verbatim dynamic subset, neutral pre-poll line, monotonic step retention, ETA + settling copy, zero-ETA while steps empty, no line-through on skipped. Look for gaps, flaky patterns, over-mocking, assertions that do not match implementation.",
    },
] };

let primary_files = "apps/web/src/app/(app)/personal-assistant/components/onboarding-progress.tsx, apps/web/src/app/(app)/personal-assistant/components/__tests__/onboarding-progress.test.tsx, apps/web/messages/en.json, apps/web/messages/hermes-translations/";

phase("Review features");
log("Reviewing " + features.len().to_string() + " features on " + base + "..." + head);

let review_jobs = [];
for f in features {
    let p = "";
    p += "You are reviewing ONE feature in a Sokosumi PR (Hermes onboarding step contract). ";
    p += "Base ref: " + base + ". Head: " + head + ". ";
    p += "Feature id: " + f.id + ". Title: " + f.title + ". ";
    p += "Focus criteria: " + f.focus + " ";
    p += "Primary files: " + primary_files + " ";
    p += "REQUIRED method: ";
    p += "1) Run `git diff " + base + "..." + head + " -- ` on the primary files (shell) or read the files + use grep. ";
    p += "2) Read onboarding-progress.tsx and the test file fully for this feature's logic. ";
    p += "3) For i18n feature, also sample en.json and one hermes-translations file + grep etaLabel/etaMinutesLabel. ";
    p += "Do NOT invent issues from the PR description alone — every finding needs a concrete file/line or code snippet you inspected. ";
    p += "Empty findings is valid ONLY after you read the code and confirmed the feature matches focus. ";
    p += "Verdict: pass (no issues), pass_with_nits (only minor/nit), fail (any blocker/major). ";
    p += "Return structured {feature, verdict, summary, findings[{severity,file,issue,suggestion}]}. Max 6 findings, most important first.";
    review_jobs.push(#{
        prompt: p,
        label: "review:" + f.id,
        capability_mode: "read-only",
        output_schema: feature_schema,
    });
}
let review_results = parallel(review_jobs);

let feature_reports = [];
let all_findings = [];
let i = 0;
for r in review_results {
    let feat = features[i];
    if r != () && r.success && r.output != () {
        feature_reports.push(r.output);
        if r.output.findings != () {
            for finding in r.output.findings {
                all_findings.push(#{
                    feature_id: feat.id,
                    feature_title: feat.title,
                    severity: finding.severity,
                    file: finding.file,
                    issue: finding.issue,
                    suggestion: finding.suggestion,
                });
            }
        }
    } else {
        log("Feature review failed or empty: " + feat.id);
        feature_reports.push(#{
            feature: feat.title,
            verdict: "fail",
            summary: "Reviewer agent failed — treat as unverified.",
            findings: [],
        });
    }
    i += 1;
}
log("Collected " + all_findings.len().to_string() + " raw findings across features");

// Cap verification fan-out
let MAX_VERIFY = 12;
let to_verify = [];
let vi = 0;
for f in all_findings {
    if vi < MAX_VERIFY {
        to_verify.push(f);
        vi += 1;
    }
}
if all_findings.len() > MAX_VERIFY {
    log("Truncated verification to " + MAX_VERIFY.to_string() + " of " + all_findings.len().to_string());
}

phase("Verify findings");
let confirmed = [];
if to_verify.len() == 0 {
    log("No findings to verify");
} else {
    let vjobs = [];
    for f in to_verify {
        let vp = "";
        vp += "Adversarially verify this PR review finding by reading the shipped code. ";
        vp += "Feature: " + f.feature_title + ". File: " + f.file + ". ";
        vp += "Claimed issue: " + f.issue + " ";
        vp += "Suggested fix: " + f.suggestion + " ";
        vp += "Use read_file/grep/git diff against the working tree. ";
        vp += "Set real=true ONLY with concrete evidence you independently inspected that the bug/gap exists. ";
        vp += "If the finding is style nit, outdated, wrong about control flow, or already handled, set real=false and severity=invalid. ";
        vp += "If real, keep or downgrade severity honestly. evidence must quote code or describe exact behavior.";
        vjobs.push(#{
            prompt: vp,
            label: "verify",
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    let j = 0;
    for v in verdicts {
        if v != () && v.success && v.output != () && v.output.real == true
            && v.output.evidence != () && v.output.evidence != "" {
            let src = to_verify[j];
            let sev = v.output.severity;
            if sev == () || sev == "invalid" { sev = src.severity; }
            confirmed.push(#{
                feature_id: src.feature_id,
                feature_title: src.feature_title,
                severity: sev,
                file: src.file,
                issue: src.issue,
                suggestion: src.suggestion,
                evidence: v.output.evidence,
                reason: v.output.reason,
            });
        }
        j += 1;
    }
    log(confirmed.len().to_string() + "/" + to_verify.len().to_string() + " findings survived verification");
}

phase("Synthesize");
let payload = json_encode(#{
    base: base,
    head: head,
    feature_reports: feature_reports,
    confirmed_findings: confirmed,
    raw_finding_count: all_findings.len(),
    confirmed_count: confirmed.len(),
});

let sp = "";
sp += "Write a concise markdown code-review report for PR feat/hermes-onboarding-step-contract. ";
sp += "You are given JSON of per-feature review verdicts and adversarially-confirmed findings only. ";
sp += "Do not re-litigate discarded findings. Structure:\n";
sp += "# PR feature review: Hermes onboarding step contract\n";
sp += "## Per-feature verdicts\n- bullet per feature: verdict + 1-line summary\n";
sp += "## Confirmed findings\n- group by severity (blocker/major/minor/nit); each: feature, file, issue, suggestion, brief evidence\n";
sp += "  If none: say None confirmed.\n";
sp += "## Residual risk / test gaps\n- short bullets if any\n";
sp += "## Overall\n- one paragraph ship/no-ship recommendation\n";
sp += "Keep under ~80 lines. No preamble. JSON input:\n" + payload;

let synth = agent(sp, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let md = "# PR feature review\n\n_Synthesis agent failed; see structured data below._\n";
if synth != () && synth.success && synth.output != () && synth.output.markdown != () {
    md = synth.output.markdown;
}

let path = write_scratch_file("pr-feature-review.md", md);
complete(#{
    path: path,
    feature_count: features.len(),
    raw_findings: all_findings.len(),
    confirmed_findings: confirmed.len(),
    feature_verdicts: feature_reports,
    confirmed: confirmed,
});
