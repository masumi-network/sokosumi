# Chat result previews review

Scope: PR #5806, merge base `5d6d6cfaae28ec81dc52f91282d8ea003fb04ed9` through `201dd6db157de741e806b37c2d837d6b21b49a4a`, followed by review of the fixes in this update. Standards and spec reviews ran independently. This is a review of the feature diff, not an audit of unrelated repository code.

## Standards

One P3 finding: repeated source/download links had indistinguishable accessible names, contrary to the Web writing rule that links identify their destination. Fixed with resource-specific localized labels in English, German and Spanish; regression assertions cover both source and download labels. No remaining documented standards findings or actionable smell findings.

## Spec

Two P2 findings: marketplace cards omitted available failure explanations and the delegated work while execution was pending. Fixed by preserving completed output, otherwise the latest failed event explanation, otherwise the bounded submitted input. A historical failure cannot replace the summary of resumed processing. Resolver regressions cover failure, running work, and resumed work. Re-review found no remaining confirmed spec defects.

## Visual verification

Rendering every preview type at 1440px desktop/light and 390px mobile/dark exposed audio/video output overflow and raw Studio state labels. Media outputs now constrain their existing FileChip to the available column and audio receives usable full width. All Studio job states now have localized display labels. Recaptured screenshots use actual app components with sample data and boundary adapters for routing/auth/actions. They are fixture evidence, not a live bot conversation or proof of external publishing, authenticated media delivery, or playback of generated content.

The gallery covers task cards, execution schedules, bot follow-ups, LinkedIn/X/Instagram scheduled posts, queued/completed/failed Studio generations, running/completed/failed marketplace work, image/PDF/text/audio/video file presentations, approval, project picker, selection reply, and unavailable results. Sample audio/video are local fixture media. No live bot or Ably messages were submitted.

## Checks

34 focused Core tests and 169 focused Web tests passed. Root typecheck and locale parity passed. Normal commit hooks run Biome and root typecheck. Independent reviewers inspected the fixes and returned no remaining actionable findings; they did not independently rerun the tests. Browser fixture screenshots were inspected and checked for horizontal overflow and page exceptions. End-to-end preview environment behavior remains outside this fixture verification.


### Clickable resource previews

Every available task, schedule, social post, Studio generation, marketplace job and file preview now opens its source when the card body is clicked. A labeled native anchor supports keyboard activation and retains mouse-button/modifier intent. Embedded links, approval/selector actions, media controls and file viewers keep their own behavior; selecting summary text does not navigate. Portal interactions are excluded from card navigation. No duplicate footer anchor or nested links are added.

Verification: 172 focused Web tests and root typecheck passed. Browser fixture checks at 1440px and 390px covered 17 resource cards per width by pointer and Enter, post body clicks, Meta/middle-click event intent, text selection, download links, audio/video controls and image viewer opening. Navigation was intercepted to verify destinations without visiting real resources. All 12 gallery screenshots were recaptured, with zero page exceptions or horizontal overflow. Independent final review returned no actionable findings. These checks use actual components with sample data, not a live bot conversation.
