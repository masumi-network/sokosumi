let meta = #{
    name: "review-pr",
    description: "Discover discrete features in any PR, review each in parallel, verify findings, synthesize report",
    when_to_use: "Any PR or branch with multiple distinct features that need independent review. Invoke as /review-pr 3404, or pass {pr}/{base,head}/features.",
    phases: [
        #{ title: "Resolve scope", detail: "PR number, base..head, or explicit features" },
        #{ title: "Discover features", detail: "extract discrete features from PR + diff" },
        #{ title: "Review features", detail: "one read-only reviewer per feature" },
        #{ title: "Verify findings", detail: "adversarial check on each reported issue" },
        #{ title: "Synthesize", detail: "write a single markdown report" },
    ],
};

let discovery_schema = #{
    "type": "object",
    "required": ["label", "base", "head", "features"],
    "properties": #{
        "label": #{ "type": "string" },
        "pr_url": #{ "type": "string" },
        "base": #{ "type": "string" },
        "head": #{ "type": "string" },
        "features": #{
            "type": "array",
            "minItems": 1,
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["id", "title", "focus", "primary_files"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "focus": #{ "type": "string" },
                    "primary_files": #{ "type": "string" },
                },
            },
        },
    },
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
// Preferred: { "pr": 3404 }
// Named slash remainder: /review-pr 3404 → args = { query, objective: "3404" }
// Also bare number/string args, or { base, head }, or { features: [...] }
// Optional: max_features (default 8, hard cap 10)

// Normalize a value into a PR number string when it is digits (optional leading #).
// Returns "" when not a bare PR token.
fn pr_token(v) {
    if v == () {
        return "";
    }
    let kind = type_of(v);
    let s = "";
    if kind == "i64" || kind == "u64" || kind == "f64" || kind == "int" {
        s = v.to_string();
    } else if kind == "string" {
        s = v;
        s.trim();
    } else {
        return "";
    }
    if s == "" {
        return "";
    }
    if s.sub_string(0, 1) == "#" {
        s = s.sub_string(1, s.len() - 1);
        s.trim();
    }
    if s == "" {
        return "";
    }
    let i = 0;
    while i < s.len() {
        let ch = s.sub_string(i, 1);
        if ch < "0" || ch > "9" {
            return "";
        }
        i += 1;
    }
    s
}

let pr = ();
let base = ();
let head = ();
let features_override = ();
let max_features = 8;
let pr_str = "";

if args != () {
    let args_kind = type_of(args);
    // Bare PR number or digit string
    if args_kind == "i64" || args_kind == "u64" || args_kind == "f64" || args_kind == "int" || args_kind == "string" {
        pr_str = pr_token(args);
    } else {
        pr = args.pr;
        base = args.base;
        head = args.head;
        features_override = args.features;
        if args.max_features != () {
            max_features = args.max_features;
        }
        // Structured pr field (number or string)
        pr_str = pr_token(pr);
        // Slash /review-pr 3404 injects remainder into objective + query
        if pr_str == "" {
            pr_str = pr_token(args.objective);
        }
        if pr_str == "" {
            pr_str = pr_token(args.query);
        }
    }
}
if max_features > 10 {
    max_features = 10;
}
if max_features < 1 {
    max_features = 1;
}

if pr_str == "" && features_override == () && base == () && head == () {
    pause("verification", "Pass a PR number: /review-pr 3404, or args {\"pr\": 3404}, or {\"base\",\"head\"}, or {\"features\":[...]}.");
}

if base == () { base = "origin/main"; }
if head == () { head = "HEAD"; }

let review_label = "diff " + base + "..." + head;
let pr_url = "";
let features = [];
let primary_files_global = "";

phase("Resolve scope");

if features_override != () {
    log("Using features override (" + features_override.len().to_string() + " items)");
    let oi = 0;
    for f in features_override {
        if oi >= max_features {
            log("Truncated override features to max_features=" + max_features.to_string());
            break;
        }
        let fid = if f.id != () { f.id + "" } else { "feature-" + oi.to_string() };
        let ftitle = if f.title != () { f.title + "" } else { fid };
        let ffocus = if f.focus != () { f.focus + "" } else { "Review this feature carefully against the diff." };
        let ffiles = if f.primary_files != () { f.primary_files + "" } else { "" };
        features.push(#{
            id: fid,
            title: ftitle,
            focus: ffocus,
            primary_files: ffiles,
        });
        oi += 1;
    }
    if pr_str != "" {
        review_label = "PR #" + pr_str;
    }
} else {
    phase("Discover features");
    let dp = "";
    dp += "You are scoping a multi-feature code review. Discover discrete features from a PR or branch diff. ";
    dp += "Return structured JSON only via the schema. ";
    if pr_str != "" {
        dp += "GitHub PR number: " + pr_str + ". ";
        dp += "REQUIRED method: ";
        dp += "1) Run: gh pr view " + pr_str + " --json number,title,body,baseRefName,headRefName,url,files ";
        dp += "2) Run: gh pr diff " + pr_str + " (or git fetch + git diff base...head if gh fails) ";
        dp += "3) Set base to origin/<baseRefName> (or merge-base form usable with git diff), head to the PR head ref or FETCH_HEAD after gh pr checkout --detach if needed. Prefer the triple-dot form origin/<base>...origin/<head> or the SHAs gh prints. ";
        dp += "4) Set label to the PR title prefixed with PR #<number>. Set pr_url from the API. ";
    } else {
        dp += "No PR number. Base ref: " + base + ". Head ref: " + head + ". ";
        dp += "REQUIRED method: ";
        dp += "1) Run: git diff --stat " + base + "..." + head + " ";
        dp += "2) Run: git log --oneline " + base + "..." + head + " ";
        dp += "3) Run: git diff " + base + "..." + head + " (skim; sample large files) ";
        dp += "4) Set label to a short description of the branch change. base/head must echo the refs you used. pr_url may be empty. ";
    }
    dp += "Feature extraction rules: ";
    dp += "- Split the change into 1.." + max_features.to_string() + " discrete user-visible or architectural features (not one feature per file). ";
    dp += "- Prefer features that map to PR description sections, conventional commit groups, or independent behaviors. ";
    dp += "- id: short kebab-case. title: human label. focus: concrete acceptance criteria to verify in code (not restating the title). ";
    dp += "- primary_files: comma-separated paths from the actual diff most relevant to that feature (max ~8 paths). ";
    dp += "- Include a tests feature only if tests are a meaningful part of the change. ";
    dp += "- Do NOT invent features outside the diff. If the PR is a single concern, return ONE feature. ";
    dp += "- Every feature must be grounded in files you saw in the diff. ";

    let discovery = agent(dp, #{
        label: "discover",
        capability_mode: "execute",
        output_schema: discovery_schema,
    });

    if discovery == () || !discovery.success || discovery.output == () {
        complete(#{
            error: "discovery_failed",
            message: "Feature discovery agent failed. Retry with args.features override or check gh/git access.",
            pr: pr_str,
            base: base,
            head: head,
        });
    }

    let disc = discovery.output;
    if disc.base != () && disc.base != "" {
        base = disc.base + "";
    }
    if disc.head != () && disc.head != "" {
        head = disc.head + "";
    }
    if disc.label != () && disc.label != "" {
        review_label = disc.label + "";
    }
    if disc.pr_url != () {
        pr_url = disc.pr_url + "";
    }

    let di = 0;
    if disc.features != () {
        for f in disc.features {
            if di >= max_features {
                log("Truncated discovered features to max_features=" + max_features.to_string());
                break;
            }
            let fid = if f.id != () { f.id + "" } else { "feature-" + di.to_string() };
            let ftitle = if f.title != () { f.title + "" } else { fid };
            let ffocus = if f.focus != () { f.focus + "" } else { "" };
            let ffiles = if f.primary_files != () { f.primary_files + "" } else { "" };
            if ffocus == "" {
                log("Dropping feature with empty focus: " + fid);
            } else {
                features.push(#{
                    id: fid,
                    title: ftitle,
                    focus: ffocus,
                    primary_files: ffiles,
                });
                di += 1;
            }
        }
    }
}

if features.len() == 0 {
    complete(#{
        error: "no_features",
        message: "No features to review. Discovery returned empty or override was empty.",
        label: review_label,
        base: base,
        head: head,
        pr: pr_str,
    });
}

// Global file hint for reviewers when a feature has no primary_files
primary_files_global = "(use git diff --name-only " + base + "..." + head + " and the feature focus to pick files)";

log("Reviewing " + features.len().to_string() + " features for " + review_label + " (" + base + "..." + head + ")");

phase("Review features");
let review_jobs = [];
for f in features {
    let files_hint = f.primary_files;
    if files_hint == () || files_hint == "" {
        files_hint = primary_files_global;
    }
    let p = "";
    p += "You are reviewing ONE discrete feature in a Sokosumi PR/branch. ";
    p += "Scope label: " + review_label + ". ";
    if pr_str != "" {
        p += "PR number: " + pr_str + ". ";
    }
    if pr_url != "" {
        p += "PR URL: " + pr_url + ". ";
    }
    p += "Base ref: " + base + ". Head: " + head + ". ";
    p += "Feature id: " + f.id + ". Title: " + f.title + ". ";
    p += "Focus criteria: " + f.focus + " ";
    p += "Primary files (start here): " + files_hint + " ";
    p += "REQUIRED method: ";
    p += "1) Run `git diff " + base + "..." + head + " --` on primary files (and related files if needed). ";
    p += "2) Read the implementation fully enough to judge the focus criteria. ";
    p += "3) Check tests that claim to cover this feature when present in the diff. ";
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
        vp += "Base: " + base + ". Head: " + head + ". ";
        vp += "Claimed issue: " + f.issue + " ";
        vp += "Suggested fix: " + f.suggestion + " ";
        vp += "Use read_file/grep/git diff against the working tree or " + base + "..." + head + ". ";
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
    label: review_label,
    pr: pr_str,
    pr_url: pr_url,
    base: base,
    head: head,
    features: features,
    feature_reports: feature_reports,
    confirmed_findings: confirmed,
    raw_finding_count: all_findings.len(),
    confirmed_count: confirmed.len(),
});

let sp = "";
sp += "Write a concise markdown code-review report for: " + review_label + ". ";
sp += "You are given JSON of discovered features, per-feature review verdicts, and adversarially-confirmed findings only. ";
sp += "Do not re-litigate discarded findings. Structure:\n";
sp += "# PR feature review: " + review_label + "\n";
sp += "## Scope\n- one line: base...head, feature count\n";
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

let md = "# PR feature review\n\n_Synthesis agent failed; see structured data below._\n\n";
md += "```json\n" + payload + "\n```\n";
if synth != () && synth.success && synth.output != () && synth.output.markdown != () {
    md = synth.output.markdown;
}

let path = write_scratch_file("pr-feature-review.md", md);
complete(#{
    path: path,
    label: review_label,
    pr: pr_str,
    pr_url: pr_url,
    base: base,
    head: head,
    feature_count: features.len(),
    raw_findings: all_findings.len(),
    confirmed_findings: confirmed.len(),
    feature_verdicts: feature_reports,
    confirmed: confirmed,
});
