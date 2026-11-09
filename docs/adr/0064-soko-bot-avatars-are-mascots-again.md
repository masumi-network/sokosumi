# Soko Bot avatars are mascots again; crafted avatars are deleted

Crafted Soko Bot avatars (#6710, SOKD-122: styles, the avatar studio, per-state stills and ffmpeg-encoded loops) are removed, and every Soko Bot avatar is a mascot again: one still picture, picked from a shared pool as before #6710. Each bot that holds a crafted avatar gets a random unused mascot, because nothing records the mascot it had before. Once a release no longer reads them, the crafted rows, columns and Blob files are deleted rather than left dormant, so they stop misleading readers and the Prisma types.

**Why not keep the stills:** they need most of the machinery (styles, studio, render rows) that is being removed.

**Why delete instead of keeping the data dormant:** bringing crafted avatars back would mean rebuilding the pipeline anyway; dormant columns would only mislead.

**Generation is on demand only:** the picker's top-up refills the pool, with no cron. A person waits only when the pool runs dry.
