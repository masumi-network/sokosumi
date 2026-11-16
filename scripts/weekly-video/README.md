# Weekly "What's new" video

`render.py` turns a short JSON brief into the 16:9 video that leads the weekly
Sokosumi announcement (the sidebar card and popup every user sees). It is plain
code: Pillow draws each frame in the Masumi brand (white page, ink text, Iris
pills) and the ffmpeg bundled with `imageio-ffmpeg` encodes H.264 with
`+faststart`. No generative model is involved.

```bash
pip install pillow imageio-ffmpeg
python3 render.py brief.json out/weekly.mp4
```

```json
{
  "week": "Nov 10 - 16, 2026",
  "items": [
    {
      "title": "Contacts know who follows you on X",
      "summary": "See who follows you, who you follow, and who follows back."
    }
  ]
}
```

Up to six items; each gets 3.4 s after a 2.6 s intro, then a 2.4 s outro. The
first run downloads Inter into the temp directory.

## Who runs it

Sokosumi's announcement Soko Bot (listed in `SOKO_BOT_ANNOUNCEMENT_BOT_IDS`)
runs it every week from a schedule: it reads the week's merged pull requests,
writes the brief, downloads this file from `main`, renders the video in its
sandbox, saves it to Files and drafts the announcement with
`save_announcement`. A person publishes it by telling the bot so in chat
(`publish_announcement`). The schedule starts a background run for the work,
because a scheduled turn that ran a command may not save files.
