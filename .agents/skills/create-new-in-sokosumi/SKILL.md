---
name: create-new-in-sokosumi
description: Render a "New in Sokosumi" announcement image for a PR and add it to the PR description.
disable-model-invocation: true
argument-hint: "[PR number or URL]"
---

# New in Sokosumi

One run turns one PR into one announcement image, built from the shared template, and places it in that PR's description. The frame (layout, the "New in Sokosumi" eyebrow, type, and colours read from `apps/web/src/app/globals.css`) lives in `template.html`. Each run writes only a content fragment. [`examples/task-activities.html`](examples/task-activities.html) is the reference fragment, and [`examples/task-activities.png`](examples/task-activities.png) is its render: copy its structure.

**This run's PR** is the one the user passed, or the open PR for the current branch.

## Steps

1. **Find the PR.** `gh pr view <PR> --json number,title,body,url,files`. Done when you hold the number, the current body, and the changed files. No PR: stop and ask for one.
2. **Collect what shipped.** Read the PR body, its linked Linear issue when you can reach it, and the diff of every file a user sees the effect of (components, copy, client behaviour). Take on-screen strings verbatim from `apps/web/messages/en.json`. Done when every claim you plan to make traces to the PR body, the diff, or `en.json`. Nothing user-visible changed: stop and say so.
3. **Write the pitch** in a copy of the example fragment:
   - `h1`: two short sentences, one per line, joined by `<br />` ("Mention them.<br />They're in.").
   - `.lede`: one sentence on what changed for the user, at most 30 words.
   - `ul`: exactly four points, each an outcome the user gets, at most 38 characters, no trailing period.
   - Sentence case throughout, in the voice of `DESIGN.md` → Voice & Content. Address the reader as "you"; UI labels keep their own capitals (Save, Jump to latest).
4. **Build the two mocks.** Each `figure.mock` holds a `figcaption` (at most 28 characters) and a `.panel`. The first shows the changed surface; the second shows the next most important visible change, or the result. A change with no on-screen difference, such as a keyboard shortcut, belongs in the points. Read the components the diff touches and mirror their structure and button variants. Compose panels from the mock kit in `template.html` (`message`, `card`, `row`, `field`, `composer`, `actions`, `btn primary|secondary|tinted`, `status`, `pill`, …) with the real strings from step 2, and format sample numbers and dates the way those messages do. Icons are lucide names: `<i data-icon="arrow-down"></i>`. Set a width with `style="flex: 0 0 304px"` when one mock needs more room. Done when every visible string is real UI copy or plausible sample data.
5. **Render.** Save the fragment as `new-in-sokosumi-pr-<n>.html` in the output directory, `/opt/cursor/artifacts/` in Cursor Cloud or `$TMPDIR` elsewhere, then render it from the repo root:

   ```bash
   OUT=/opt/cursor/artifacts  # or "$TMPDIR"
   node .agents/skills/create-new-in-sokosumi/render.mjs "$OUT/new-in-sokosumi-pr-<n>.html" "$OUT/new-in-sokosumi-pr-<n>.png"
   ```

   Exit 2 means something overflows; it is outlined in red in the PNG. Shorten the copy or the mock and render again. Done when the script exits 0.
6. **Review the image.** Open the PNG and compare it with `examples/task-activities.png`. Done when the headline is two lines, each point and caption sits on one line, nothing is clipped at a panel's bottom edge, and the mocks read as the real UI.
7. **Add it to the PR description.** Keep the existing description as it is. Add this section at the end, or replace the section between the markers when a previous run left one:

   ```markdown
   <!-- new-in-sokosumi:start -->
   ## New in Sokosumi

   <img alt="New in Sokosumi: <headline>" src="<png path>" />
   <!-- new-in-sokosumi:end -->
   ```

   - **Cursor Cloud:** call `ManagePullRequest` `update_pr` with the whole body and the absolute `/opt/cursor/artifacts/…png` path as `src`; the tool uploads it and rewrites the URL. Leave out any `CURSOR_AGENT_PR_BODY_BEGIN/END` markers and the Cursor footer links, which the tool manages.
   - **Anywhere else:** GitHub has no API for uploading images to a PR. Give the user the PNG path and ask them to drag it into the description.

   Done when `gh pr view <PR> --json body` shows the section with an `https://` image URL, or the user has the PNG path.
