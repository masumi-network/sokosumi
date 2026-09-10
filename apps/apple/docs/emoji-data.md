# Emoji data for native rendering

Approved on 2026-09-10. Generated from the exact data used by web's installed
remark-emoji 5.0.2 / node-emoji 2.2.0 pipeline. No JavaScript runtime is bundled.

| Resource | Source | Entries | SHA-256 |
| --- | --- | --- | --- |
| shortcodes.json | emojilib 2.4.0 (`emojis.json` name → char) | 1,570 | `3afcba7d834ea2cafe4d4e26082faa769e51b81c61914724f2868c875f25025e` |
| emoticons.json | emoticon 4.1.0 (`index.js` emoji/emoticons) | 29 groups / 322 spellings | `e6ef43a6d7ae89ec74dbcdd2c6122250ae2bac0055ac4e1453bbe8fd8718b25c` |

The corresponding MIT notices are included verbatim as emojilib-LICENSE.txt and
emoticon-LICENSE.txt. Upstream: https://github.com/muan/emojilib/tree/v2.4.0 and
https://github.com/wooorm/emoticon/tree/4.1.0.

Do not hand-edit the JSON. After the repository's pinned pnpm install, run
`node apps/apple/scripts/update-emoji-data.mjs` from the repository root. It
resolves the data through web's actual dependency graph, checks the approved
source versions, preserves order, copies notices and prints output hashes.
Review version changes separately before changing the version guards.

Swift conversion is intentionally not implemented in this prerequisite PR.
Shortcode matching must be case-sensitive, unknown values must remain literal,
and emoticon group order must be preserved. Conversion belongs on Markdown text
nodes, never source code or link destinations. Raw-message jumbo sizing remains
independent from shortcode conversion.
