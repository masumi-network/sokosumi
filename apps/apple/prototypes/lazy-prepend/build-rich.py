#!/usr/bin/env python3
"""Build real message rows in a disposable workspace; never edit production sources."""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

fixture = Path(__file__).resolve().parent
apple = fixture.parents[1]
output = Path(sys.argv[1]).resolve()
source = output / "AppleSource"
app = output / "ScrollReproduction.app"
assert apple not in output.parents and output != apple, "Put build output outside apps/apple"
assert not source.exists() and not app.exists(), "Use a fresh output directory"
output.mkdir(parents=True, exist_ok=True)

# Ask Xcode for the scheme and reuse this checkout's normal cache unless explicitly supplied.
workspace = apple / "Sokosumi.xcworkspace"
base = ["xcodebuild", "-workspace", str(workspace), "-scheme", "Sokosumi",
        "-configuration", "Release", "-destination", "platform=macOS,arch=arm64",
        "-skipPackagePluginValidation"]
with (output / "schemes.json").open("w") as log:
    subprocess.run(["xcodebuild", "-workspace", str(workspace), "-list", "-json"], stdout=log, check=True)
assert "Sokosumi" in json.loads((output / "schemes.json").read_text())["workspace"]["schemes"]
if os.environ.get("REPRO_DERIVED_DATA"):
    derived = Path(os.environ["REPRO_DERIVED_DATA"]).expanduser().resolve()
else:
    settings = json.loads(subprocess.check_output(base + ["-showBuildSettings", "-json"], text=True))
    product = next(item["buildSettings"] for item in settings if item["target"] == "Sokosumi")
    derived = Path(product["BUILD_DIR"]).parents[1]

shutil.copytree(apple, source, ignore=shutil.ignore_patterns(".build", "prototypes", "xcuserdata", ".DS_Store"))
entry = source / "Sokosumi/App/SokosumiApp.swift"
shutil.copyfile(fixture / "ScrollReproduction.swift", entry)
shutil.copyfile(fixture / "RichRowFixture.swift", entry.with_name("RichRowFixture.swift"))
# One-component controls affect only these copied files. The corpus and row IDs stay identical.
def replace_once(path, before, after):
    text = path.read_text()
    assert text.count(before) == 1, "Production seam changed: " + str(path)
    path.write_text(text.replace(before, after))

rendering = source / "Sokosumi/Chat/Rendering"
replace_once(rendering / "MessageMarkdownView.swift", ".textSelection(.enabled)", ".reproductionBodySelection()")
for name in ["MessageCodeBlock.swift", "MessageQuoteView.swift"]:
    replace_once(rendering / name, ".textSelection(.enabled)", ".reproductionBodySelection(nested: true)")
replace_once(rendering / "MessageCodeBlock.swift", ".task(id: input) {", '.task(id: input) {\n      guard RichRowFixture.omittedComponent != "code-highlighting" else { return }')
replace_once(rendering / "ExpandableMessageBody.swift", "  var body: some View {", '''  var body: some View {
    if RichRowFixture.omittedComponent == "clamp" {
      VStack(alignment: .leading, spacing: 4) {
        content.fixedSize(horizontal: false, vertical: true)
      }
    } else {
      clampedBody
    }
  }

  private var clampedBody: some View {''')

row = source / "Sokosumi/Chat/Timeline/MessageRowView.swift"
original_row = row.read_text()
replace_once(row, "  private struct DeliveryFeedback: View {", "  struct DeliveryFeedback: View {")
replace_once(row, "    var body: some View {\n      HStack(alignment: .top, spacing: 14) {", '''    var body: some View {
      let _ = RichRowFixture.recordBody(message.id)
      if RichRowFixture.omittedComponent == "row-interactions" {
        rowContent.padding(.top, isContinuation ? 0 : 8)
      } else {
        interactiveBody
      }
    }

    private var rowContent: some View {
      HStack(alignment: .top, spacing: 14) {''')
replace_once(row, "      .padding(.horizontal, horizontalInset)\n      .contentShape(.rect)", '''      .padding(.horizontal, horizontalInset)
    }

    private var hoverBody: some View {
      rowContent
      .contentShape(.rect)''')
replace_once(row, '      .alert(failure?.title ?? "", item: $failure)', '''    }

    @ViewBuilder private var presentationBody: some View {
      if RichRowFixture.omittedComponent == "row-alerts" {
        hoverBody
      } else {
        alertedBody
      }
    }

    private var alertedBody: some View {
      hoverBody
      .alert(failure?.title ?? "", item: $failure)''')
replace_once(row, "      // AppKit answers a right-click on selectable text with its own editing menu, so the row opens its menu itself.", '''    }

    private var interactiveBody: some View {
      presentationBody
      // AppKit answers a right-click on selectable text with its own editing menu, so the row opens its menu itself.''')

replace_once(rendering / "MessageMarkdownView.swift", "  private func attachmentContent(_ text: AttributedString) -> some View {", "  @ViewBuilder private func attachmentContent(_ text: AttributedString) -> some View {")
replace_once(rendering / "MessageMarkdownView.swift", "    return VStack(alignment: .leading, spacing: 8) {\n      ForEach(segments) { segment in", '''    if ["flat-text", "flat-markdown"].contains(RichRowFixture.omittedComponent), segments.count == 1, let segment = segments.first, segment.attachment == nil {
      Text(styled(segment.text)).fixedSize(horizontal: false, vertical: true)
    } else {
      wrappedSegments(segments)
    }
  }

  private func wrappedSegments(_ segments: [MessageAttachmentSegment]) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(segments) { segment in''')

# Flatten only singleton collections; keep identical production children and spacing.
replace_once(rendering / "MessageMarkdownView.swift", '''          VStack(alignment: .leading, spacing: 8) {
            ForEach(document.segments) { segment in
              if segment.files.isEmpty {
                MarkdownBlocksView(blocks: segment.blocks)
              } else if segment.usesLargeImage, let file = segment.files.first {
                MessageAttachmentView(attachment: file.attachment).id(file.attachment.url)
              } else {
                WrappingRow(alignment: .top, constrainsWidth: true) {
                  ForEach(segment.files) { file in
                    MessageAttachmentView(attachment: file.attachment, compact: true).id(file.attachment.url)
                  }
                }
                .padding(.bottom, segment.files.last?.attachment.kind == .file ? 8 : 0)
              }
            }
          }''', "          documentContent(document)")
replace_once(rendering / "MessageMarkdownView.swift", "  @State private var document: MessageMarkdown?", '''  @ViewBuilder private func documentContent(_ document: MessageMarkdown) -> some View {
    if RichRowFixture.omittedComponent == "flat-markdown", document.segments.count == 1, let segment = document.segments.first {
      segmentContent(segment)
    } else {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(document.segments) { segment in
          segmentContent(segment)
        }
      }
    }
  }

  @ViewBuilder private func segmentContent(_ segment: MessageMarkdownSegment) -> some View {
    if segment.files.isEmpty {
      MarkdownBlocksView(blocks: segment.blocks)
    } else if segment.usesLargeImage, let file = segment.files.first {
      MessageAttachmentView(attachment: file.attachment).id(file.attachment.url)
    } else {
      WrappingRow(alignment: .top, constrainsWidth: true) {
        ForEach(segment.files) { file in
          MessageAttachmentView(attachment: file.attachment, compact: true).id(file.attachment.url)
        }
      }
      .padding(.bottom, segment.files.last?.attachment.kind == .file ? 8 : 0)
    }
  }

  @State private var document: MessageMarkdown?''')
replace_once(rendering / "MessageMarkdownView.swift", "  var body: some View {\n    VStack(alignment: .leading, spacing: 8) {\n      ForEach(blocks) { block in", '''  var body: some View {
    if RichRowFixture.omittedComponent == "flat-markdown", blocks.count == 1, let block = blocks.first {
      MarkdownBlockView(block: block)
    } else {
      wrappedBlocks
    }
  }

  private var wrappedBlocks: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(blocks) { block in''')

# Shell controls affect copied sources only. row-content covers ordinary fixture messages;
# the other controls retain every production content branch and action.
text = row.read_text()
begin = text.index("      .overlay(alignment: .bottomTrailing) {")
finish = text.index("      .onChange(of: showsActions)", begin)
overlays = text[begin:finish]
separator = "      .overlay(alignment: .topTrailing) {\n"
assert overlays.count(separator) == 1, "Production decoration overlays changed"
seen, actions = overlays.split(separator)
seen = seen.removeprefix("      .overlay(alignment: .bottomTrailing) {\n").removesuffix("      }\n")
actions = actions.removesuffix("      }\n")
seen = seen.replace("            .padding(.bottom, 4)", "            .padding(.bottom, 4)\n            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)")
helpers = '''    @ViewBuilder private func decorationOverlays<Content: View>(_ content: Content) -> some View {
      if RichRowFixture.omittedComponent == "row-overlays" {
        content.overlay(alignment: .topTrailing) {
          ZStack(alignment: .topTrailing) {
''' + seen + actions + '''          }
        }
      } else {
        content
''' + overlays + '''      }
    }

'''
text = text[:begin] + "      .transformReproductionDecorations { decorationOverlays($0) }\n" + text[finish:]
row.write_text(text.replace("    private var hoverBody: some View {", helpers + "    private var hoverBody: some View {", 1))
replace_once(row, "    private var rowContent: some View {", '''    @ViewBuilder private var rowContent: some View {
      if RichRowFixture.omittedComponent == "row-content" {
        FixtureContentRow(message: message, document: preparedDocument, topInset: 0,
                          channels: channels, room: room, quoteJump: message.quote.flatMap { quoteJump(for: $0) }, toggleReaction: reactionAction)
      } else {
        fullRowContent
      }
    }

    private var fullRowContent: some View {''')
replace_once(row, '''      .onContinuousHover { phase in
        let hovering = switch phase {
        case .active: true
        case .ended: false
        }
''', '''      .reproductionRowHover { hovering in
''')
replace_once(row, '''      .task(id: (isHovered || isReplyHovered) && !transcriptIsScrolling) {
        hoverRested = false''', '''      .task(id: (isHovered || isReplyHovered) && !transcriptIsScrolling) {
        if RichRowFixture.omittedComponent != "hover-writes" || hoverRested {
          hoverRested = false
        }''')

replace_once(row, '''      .accessibilityActions {
        ForEach(menuAvailability.sections(hasSelection: false).joined().filter { !menuBusy.contains($0) }, id: \.self) { action in
          Button(action.title, role: action == .delete ? .destructive : nil) { performMenuAction(action) }
        }
      }''', '''      .reproductionRowAccessibility(availability: menuAvailability, busy: menuBusy, perform: performMenuAction)''')
replace_once(source / "Sokosumi/Chat/Timeline/MessageContextMenu.swift", "    func makeNSView(context _: Context) -> MessageContextMenuView {", '''    func sizeThatFits(_ proposal: ProposedViewSize, nsView _: MessageContextMenuView, context _: Context) -> CGSize? {
      guard RichRowFixture.omittedComponent == "menu-sizing",
            let width = proposal.width, let height = proposal.height,
            width.isFinite, height.isFinite else { return nil }
      return CGSize(width: width, height: height)
    }

    func makeNSView(context _: Context) -> MessageContextMenuView {''')

# Keep the same alerts/bindings/actions, attached to an invisible background leaf.
text = row.read_text()
alert_start = text.index("    private var alertedBody: some View {\n      hoverBody")
alert_end = text.index("\n    private var interactiveBody:", alert_start)
alerts = text[alert_start:alert_end]
leaf = alerts.replace("private var alertedBody", "private var alertLeaf").replace("      hoverBody\n", "      Color.clear\n", 1)
wrapped = '''    @ViewBuilder private var alertedBody: some View {
      if RichRowFixture.omittedComponent == "alert-host" {
        hoverBody.background { alertLeaf }
      } else {
        inlineAlertedBody
      }
    }

''' + alerts.replace("private var alertedBody", "private var inlineAlertedBody") + leaf
row.write_text(text[:alert_start] + wrapped + text[alert_end:])

# A separate copied row tests state-box setup while retaining every production branch/action.
# Generate it from the same source so the experiment cannot drift into a second renderer.
text = row.read_text()
start = text.index("  struct MessageRowView: View {")
end = text.index("\n  #if DEBUG", start)
grouped = text[start:end].replace("MessageRowView", "GroupedMessageRowView")
fields = re.findall(r"    @State private var (\w+)([^\n]*)", grouped)
assert len(fields) == 12, "Production row state changed"
state = "    private struct InteractionState {\n"
aliases = "    @State private var interaction = InteractionState()\n"
for name, declaration in fields:
    state += "      var " + name + declaration + "\n"
    annotation = declaration.split("=", 1)[0].strip()
    kind = annotation[1:].strip() if annotation.startswith(":") else ("[ReactionEmoji]" if name == "quickReactions" else "Bool")
    aliases += "    private var " + name + ": " + kind + " {\n      get { interaction." + name + " }\n      nonmutating set { interaction." + name + " = newValue }\n    }\n"
    grouped = grouped.replace("    @State private var " + name + declaration + "\n", "", 1)
    grouped = re.sub(r"\$" + name + r"\b", "$interaction." + name, grouped)
state += "    }\n"
grouped = grouped.replace("    @Environment(\\.accessibilityReduceMotion)", state + aliases + "    @Environment(\\.accessibilityReduceMotion)", 1)
metrics = text[start:end].replace("MessageRowView", "SharedMetricsMessageRowView")
replace_metrics = {
    '    @ScaledMetric(relativeTo: .body) private var replyActionHeight: CGFloat = 28': '    @Environment(\\.reproductionRowActionMetrics) private var actionMetrics\n    private var replyActionHeight: CGFloat { actionMetrics.replyHeight }',
    '    @ScaledMetric(relativeTo: .callout) private var actionIconSize: CGFloat = 16': '    private var actionIconSize: CGFloat { actionMetrics.iconSize }',
}
for before, after in replace_metrics.items():
    assert metrics.count(before) == 1, "Production row metrics changed"
    metrics = metrics.replace(before, after)
original_start = original_row.index("  struct MessageRowView: View {")
original_end = original_row.index("\n  #if DEBUG", original_start)
original = original_row[original_start:original_end].replace("MessageRowView", "OriginalMessageRowView")
row.write_text(text[:end] + "\n" + grouped + "\n" + metrics + "\n" + original + text[end:])

# Scope the fixture flag to the copied app. A global override erases SwiftPM's SWIFT_PACKAGE flag.
project = source / "Sokosumi.xcodeproj/project.pbxproj"
text = project.read_text()
lines = text.splitlines(keepends=True)
app_signing = [line for line in lines if "CODE_SIGN_ENTITLEMENTS =" in line]
assert len(app_signing) == 2, "Expected the app's Debug and Release signing settings"
for line in set(app_signing):
    text = text.replace(line, line + '\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = "$(inherited) RICH_ROWS";\n')
project.write_text(text)
# Native action tests host this fixture app; keep its timed loop idle during tests.
scheme = source / "Sokosumi.xcodeproj/xcshareddata/xcschemes/Sokosumi.xcscheme"
tree = ET.parse(scheme)
test_action = tree.getroot().find("TestAction")
assert test_action is not None, "Production test action changed"
test_action.set("shouldUseLaunchSchemeArgsEnv", "NO")
variables = ET.SubElement(test_action, "EnvironmentVariables")
ET.SubElement(variables, "EnvironmentVariable", key="REPRO_INSPECT", value="1", isEnabled="YES")
tree.write(scheme, encoding="UTF-8", xml_declaration=True)
base[base.index(str(workspace))] = str(source / "Sokosumi.xcworkspace")
command = base + [
    "-derivedDataPath", str(derived), "DEVELOPMENT_TEAM=GVWN7HXYJB", "CODE_SIGN_STYLE=Manual",
    "CODE_SIGN_IDENTITY=Developer ID Application: utxo AG (GVWN7HXYJB)",
    "OTHER_CODE_SIGN_FLAGS=--timestamp=none", "PROVISIONING_PROFILE_SPECIFIER=",
    "SOKOSUMI_ENTITLEMENTS_GVWN7HXYJB=" + str(output / "Profile.entitlements"),
    "PRODUCT_BUNDLE_IDENTIFIER=com.sokosumi.swiftui-prepend-reproduction",
    "ENABLE_CODE_COVERAGE=NO",
    "CLANG_ENABLE_CODE_COVERAGE=NO", "ONLY_ACTIVE_ARCH=YES", "build",
]
print("Building real rows; log: " + str(output / "build.log"), flush=True)
with (output / "build.log").open("w") as log:
    result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
if result.returncode:
    raise SystemExit("Xcode build failed; inspect " + str(output / "build.log"))
shutil.copytree(derived / "Build/Products/Release/Sokosumi.app", app)
(app / "Contents/MacOS/Sokosumi").rename(app / "Contents/MacOS/ScrollReproduction")
