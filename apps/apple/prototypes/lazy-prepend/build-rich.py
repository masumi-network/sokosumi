#!/usr/bin/env python3
"""Build real message rows in a disposable workspace; never edit production sources."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

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

# Scope the fixture flag to the copied app. A global override erases SwiftPM's SWIFT_PACKAGE flag.
project = source / "Sokosumi.xcodeproj/project.pbxproj"
text = project.read_text()
lines = text.splitlines(keepends=True)
app_signing = [line for line in lines if "CODE_SIGN_ENTITLEMENTS =" in line]
assert len(app_signing) == 2, "Expected the app's Debug and Release signing settings"
for line in set(app_signing):
    text = text.replace(line, line + '\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = "$(inherited) RICH_ROWS";\n')
project.write_text(text)
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
