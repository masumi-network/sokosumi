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

# dmgbuild ships builtin-arrow.tiff at 640x240, so the window is sized to it
# exactly and the icons sit on the arrow's endpoints.
background = "builtin-arrow"
window_rect = ((200, 200), (640, 240))
icon_size = 128
icon_locations = {
    app_name: (160, 120),
    "Applications": (480, 120),
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
