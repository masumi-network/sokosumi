# dmgbuild settings for the downloadable disk image.
#
# Used by the `publish` job in .github/workflows/apple.yml:
#   dmgbuild -s dmg-settings.py -D app=<path to Sokosumi.app> Sokosumi <out.dmg>
#
# dmgbuild writes the Finder view settings straight into the volume's
# .DS_Store via the ds_store and mac_alias modules. It never drives Finder
# through AppleScript, which is what makes it work on a headless CI runner.

import os.path

# -D app=... from the command line; the default keeps a local run working
# after `xcodebuild -exportArchive -exportPath build/export`.
app = defines.get("app", "build/export/Sokosumi.app")  # noqa: F821
app_name = os.path.basename(app)

# What goes in the volume. The Applications symlink is what makes the window
# a drag-to-install rather than something the reader has to think about.
files = [app]
symlinks = {"Applications": "/Applications"}

# The volume's own icon in Finder's sidebar and on the desktop. Xcode emits a
# standalone AppIcon.icns beside the compiled Assets.car, so this needs no
# separate asset.
badge_icon = None
icon = os.path.join(app, "Contents", "Resources", "AppIcon.icns")

# No background image, deliberately. A background is baked in and static, so
# it cannot follow the system appearance: any image we ship is a bright panel
# for every dark-mode reader, or a dark one for every light-mode reader.
# Leaving it unset lets Finder draw its own, which adapts. It also means no
# PNG to commit at 1x and 2x and keep in sync with the brand colour.
#
# dmgbuild's bundled `builtin-arrow` was tried and rejected: it is a chunky
# 2005-era blue arrow that fights the flat app icon. The Applications alias
# badge already communicates the drag without one.
#
# 640x400, not 640x240: a 128px icon plus its label does not fit in 240, and
# Finder silently grows the window to about 704x323 when it does not. At 400
# the window opens at exactly the size set here.
window_rect = ((200, 200), (640, 400))
icon_size = 128
icon_locations = {
    app_name: (160, 170),
    "Applications": (480, 170),
}

default_view = "icon-view"
show_icon_preview = False

# Chrome the reader does not need in a one-window drag-to-install.
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

# LZFSE, matching what the workflow produced before dmgbuild replaced the
# hand-rolled diskutil call. Smaller than UDZO and fine against an app that
# already requires macOS 26.
format = "ULFO"
