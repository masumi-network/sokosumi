# 07: Store new original-style avatars as WebP

**What to build:** New original-style Soko Bot avatars drawn by the top-up are stored as WebP instead of PNG, so every surface loads a smaller picture at the same visible quality. Web shows the avatar URL as is (no `next/image`), so the stored format is what browsers download. Core already depends on `sharp` for the encode. Avatars already in use keep their PNG. Spec: `../spec.md`.

**Blocked by:** 01: Pick an original-style avatar at onboarding

**Status:** ready-for-agent

- [ ] The top-up encodes each drawn original-style avatar to WebP with `sharp` before upload, at a quality with no visible loss at the largest size Web shows
- [ ] New original-style pictures go under their own Blob prefix (`soko-bots/avatars/original/`), so 06's cleanup can never mistake them for crafted `.webp` files
- [ ] Existing PNG avatars and their URLs are untouched
- [ ] The Core avatar route test checks that a topped-up avatar is a WebP under the new prefix
