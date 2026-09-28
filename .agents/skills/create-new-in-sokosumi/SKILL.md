---
name: create-new-in-sokosumi
description: Render a "New in Sokosumi" announcement image from a PR or any context you give, and show it in the reply.
disable-model-invocation: true
argument-hint: "[PR, description, or screenshots]"
---

# New in Sokosumi

One run turns one change into one announcement image. The frame (layout, the "New in Sokosumi" eyebrow, type, and colours read from `apps/web/src/app/globals.css`) lives in `template.html`; each run writes only a content fragment into it. The deliverable is the image, shown in your reply; it is never committed or attached to a PR.

**This run's context** is whatever the user sent with the command: a PR, a description, screenshots, or a mix. With nothing sent, it is the open PR for the current branch.

## Steps

1. **Gather the context.** For a PR: `gh pr view <PR> --json number,title,body,url,files`, then read its body, its linked Linear issue when you can reach it, and the diff of every file a user sees the effect of. For a description or screenshots: read them, and find the surfaces they name in `apps/web`. Take on-screen strings verbatim from `apps/web/messages/en.json`. Done when every claim you plan to make traces to what the user sent, the diff, or `en.json`. Nothing user-visible to announce: stop and say so.
2. **Write the pitch** into a fragment shaped like the skeleton below:
   - `h1`: two short sentences, one per line, joined by `<br />` ("Mention them.<br />They're in.").
   - `.lede`: one sentence on what changed for the user, at most 30 words.
   - `ul`: exactly four points, each an outcome the user gets, at most 38 characters, no trailing period.
   - Sentence case throughout, in the voice of `DESIGN.md` → Voice & Content. Address the reader as "you"; UI labels keep their own capitals (Save, Jump to latest).
3. **Build the mocks.** One `figure.mock` per visible change worth showing, one to three, in order of importance. One mock spans the whole right side; with three, each panel is narrow, so each shows one small element. A change with no on-screen difference, such as a keyboard shortcut, belongs in the points. Each mock holds a `figcaption` (at most 28 characters) and a `.panel`. Read the components involved and mirror their structure and button variants. Compose panels from the mock kit in `template.html` (`message`, `card`, `row`, `field`, `composer`, `actions`, `btn primary|secondary|tinted`, `status`, `pill`, …) with the real strings from step 1, and format sample numbers and dates the way those messages do. Icons are lucide names: `<i data-icon="arrow-down"></i>`. Give one mock more room with `style="flex: 0 0 304px"`. Done when every visible string is real UI copy or plausible sample data.

   ```html
   <section class="pitch">
     <h1>Mention them.<br />They're in.</h1>
     <p class="lede">…</p>
     <ul><li>…</li><li>…</li><li>…</li><li>…</li></ul>
   </section>
   <section class="mocks">
     <figure class="mock">
       <figcaption>Mention in a comment</figcaption>
       <div class="panel">
         <div class="row"><span class="title">Activities</span><span class="btn tinted"><i data-icon="arrow-down"></i>Jump to latest</span></div>
         <div class="card"><div class="row"><span class="avatar">A</span><b>Ada</b> commented<span class="when">2h</span></div><p>…</p></div>
       </div>
     </figure>
   </section>
   ```
4. **Render.** Save the fragment as `new-in-sokosumi-<slug>.html` in the output directory, `/opt/cursor/artifacts/` in Cursor Cloud or `$TMPDIR` elsewhere, then render it from the repo root:

   ```bash
   OUT=/opt/cursor/artifacts  # or "$TMPDIR"
   node .agents/skills/create-new-in-sokosumi/render.mjs "$OUT/new-in-sokosumi-<slug>.html" "$OUT/new-in-sokosumi-<slug>.png"
   ```

   Exit 2 means something overflows; it is outlined in red in the PNG. Shorten the copy or simplify the mock and render again. Done when the script exits 0.
5. **Review the image.** Open the PNG. Done when the headline is two lines, each point and caption sits on one line, nothing is clipped at a panel's bottom edge, each panel's content fills most of its height, and the mocks read as the real UI.
6. **Deliver.** Show the image in your reply: in Cursor, `<img alt="New in Sokosumi: <headline>" src="<absolute png path>" />`; elsewhere, attach or link the PNG the way the host shows files. Keep the PNG and fragment out of the repo and leave the PR description untouched. Done when the image appears in your reply.
