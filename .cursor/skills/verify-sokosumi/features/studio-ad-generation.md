# Studio ad generation

Turning a brief into ads in a project. Auto routes images and ads to Gemini Pro (with Ideogram v3 lettering the headline), text-heavy images to Ideogram v3, and video to MiniMax H3 Max.

## Sub-features

- `ad-generate`: **Generate** in the composer starts jobs; the cost line reads **Will run Nx on N model(s), N credits** before you press it.
- `ad-generate-advanced`: a model picked under **Advanced** replaces Auto for that run.
- `ad-gallery`: finished ads appear in the project gallery (**Ad gallery**), with **Group by product**.

## How to get to it (user POV)

- **Content Studio** in the Marketing sidebar, then **Select project** (or open `/studio?projectId=<uuid>`), write a brief, press **Generate** (or Ctrl/⌘ + Enter).

## Driving it with drive.mjs

- Before generating, prove the plan with `drive.mjs studio-composer`: the cost line and the Advanced selection are the observable state.
- A real generation spends credits and calls fal. Only run it on an instance with real provider keys and a funded test workspace, and say so in the proof. Capture: the composer before **Generate**, the pending tile, the finished ad, and a reload showing it is still there.

## Gotchas

- The fast-path local stack has no provider keys and no projects: generation is out of scope there. Report "not run: no provider keys" instead of faking it.
- Recraft V3 accepts at most 1,000 prompt characters; Studio trims brand text first and keeps the user's brief.
