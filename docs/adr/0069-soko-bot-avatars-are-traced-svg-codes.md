# Soko Bot avatars are traced SVG codes

A Soko Bot's face is a **feature code** (`v1.<animal>.<bg>.<body>.<mark>.<l|r>.<S|M|L>.<eyes>.<mouth>.<cheeks>.<hat>`) over 16 traced animals, drawn as SVG by `@sokosumi/soko-bot`. `SokoBot.avatarCode` holds it and is unique, so no two bots look alike. `avatarImageUrl` stays and holds a 512 px WebP still of the code (Blob `soko-bots/avatars/code/<code>.webp`), so every API field and client that shows the bot as a plain image keeps working.

Supersedes the pool part of [0064](0064-soko-bot-avatars-are-original-style-again.md): new bots get a random free code instead of claiming a generated picture. `avatarId` keeps working until the pool is deleted.

**Why:** the pool costs a paid image per avatar and a top-up wait, and its pictures cannot move or react. A code is free, instant, unique by construction, and renders live in Web.

**Conversion:** `pnpm --filter @sokosumi/core soko-bot:avatar-codes` (dry run; `--apply` writes) gives each bot without a code the closest free look to its pool picture, else a random one.

**Consequences:**

- Changing a look is `PUT .../avatar-code`; a taken code is 409 `avatar_code_taken`, a bad one 422 `avatar_code_invalid`. Setting a code releases the bot's pool row.
- Removing the pool (tables, top-up, claim routes, generation cap) follows in a later PR, once every bot has a code.
- A bot whose still failed to render at create has no face until a code is set.
