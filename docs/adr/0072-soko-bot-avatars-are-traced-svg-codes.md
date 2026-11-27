# Soko Bot avatars are traced SVG codes

A Soko Bot's face is a **feature code** (`v1.<animal>.<bg>.<body>.<mark>.<l|r>.<S|M|L>.<eyes>.<mouth>.<cheeks>.<hat>`) over 16 traced animals, drawn as SVG by `@sokosumi/soko-bot`. `SokoBot.avatarCode` holds it and is unique, so no two bots look alike. `avatarImageUrl` stays and holds a 512 px WebP still of the code (Blob `soko-bots/avatars/code/<code>.webp`), so every API field and client that shows the bot as a plain image keeps working.

Supersedes the pool part of [0064](0064-soko-bot-avatars-are-original-style-again.md): new bots get a random free code instead of claiming a generated picture.

**Why:** the pool costs a paid image per avatar and a top-up wait, and its pictures cannot move or react. A code is free, instant, unique by construction, and renders live in Web.

**Conversion (done 2026-11-17):** a one-off script gave each bot without a code the closest free look to its pool picture (same animal, background and colours), else a random one. It ran on production mainnet and preprod, leaving 0 live bots without a code, and was deleted with the pool.

**Consequences:**

- Changing a look is `PUT .../avatar-code`; a taken code is 409 `avatar_code_taken`, a bad one 422 `avatar_code_invalid`.
- Removing the pool (tables, top-up, claim routes, generation cap) follows in a later PR, once every bot has a code.
- A bot whose still failed to render at create has no face until a code is set.

**Pool removed:** the `soko_bot_avatar` table, fal generation and top-up, the list, claim and restyle routes, `avatarId`, the Web picker, the admin pool picker, the conversion script and the Blob prefix-move script are deleted. This was safe because the conversion had given every bot a code before this shipped, and a bot's face is read from `avatarCode` and `avatarImageUrl`, never from the pool. Admins change a bot's look in the same avatar studio, on the admin advanced page (`PUT /v1/admin/soko-bots/{id}/avatar-code`). Old pool images stay in Blob until someone deletes the `soko-bots/avatars/` objects outside `code/`.
