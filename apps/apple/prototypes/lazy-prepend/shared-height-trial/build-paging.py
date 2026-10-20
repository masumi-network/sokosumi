#!/usr/bin/env python3
"""Replay the recorded paging harness in a fresh disposable workspace, with team signing."""
import argparse
import os
import re
from pathlib import Path
import subprocess
import sys
import shutil
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("checkout", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--configuration", choices=["Release", "Debug"], default="Release")
parser.add_argument("--prepare-only", action="store_true", help="Copy/instrument without invoking Xcode")
args = parser.parse_args()
repo = args.checkout.resolve()
root = args.output.resolve()
configuration = args.configuration
source = root / "AppleSource"
assert not root.exists(), "Use a fresh output directory"
assert repo not in root.parents, "Put output outside the source checkout"
root.mkdir(parents=True)
doc = (repo / "apps/apple/docs/scrolling-hover-harness.md").read_text()
files = dict(re.findall(r"<!-- file: ([^ ]+) -->\n```[^\n]*\n(.*?)\n```", doc, re.S))
for name in ["setup.py", "PagingProbe.swift"]:
    (root / name).write_text(files[name] + "\n")
subprocess.run([sys.executable, str(root / "setup.py"), str(repo), str(source), "paging"], check=True)
entry=source/'Sokosumi/App/SokosumiApp.swift'
if 'HITCH_INSPECT' not in entry.read_text():
 s=(root/'PagingProbe.swift').read_text().replace('import AppKit','import AppKit\nimport CryptoKit',1)
 s=s.replace('  static var rowBodies = 0','  static var rowBodies = 0\n  static var fallbackMeasurements = 0\n  static var sharedMeasurements = 0\n  static var publications: [(Double, Int)] = []',1)
 s=s.replace('  func applicationDidFinishLaunching(_: Notification) {','  func applicationDidFinishLaunching(_: Notification) {\n    guard ProcessInfo.processInfo.environment["HITCH_INSPECT"] != "1" else { return }',1)
 s=s.replace('link.timestamp','ProcessInfo.processInfo.systemUptime')
 # Use the already measured native-scroller + Core-page sequence, identical in both variants.
 begin=s.index('    for _ in 0 ..< flicks {',s.index('    let flicks ='))
 end=s.index('    touches?.cancel()',begin)
 original=s[begin:end]
 scripted='''    if let pages = env["HITCH_SCRIPTED_PAGES"].flatMap(Int.init) {
      for _ in 0..<pages {
        scroll.scrollerStyle = .legacy
        host.layoutSubtreeIfNeeded()
        try? await Task.sleep(for: .milliseconds(100))
        if let scroller = scroll.verticalScroller {
          let knob = scroller.rect(for: .knob)
          let start = scroller.convert(NSPoint(x: knob.midX, y: knob.midY), to: nil)
          for (type, up) in [(NSEvent.EventType.leftMouseDown, 0.0), (.leftMouseDragged, 40), (.leftMouseDragged, 700), (.leftMouseUp, 700)] {
            if let event = NSEvent.mouseEvent(with: type, location: NSPoint(x: start.x, y: start.y + up), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
              NSApp.postEvent(event, atStart: false)
            }
          }
        }
        try? await Task.sleep(for: .milliseconds(450))
        let before = state.timeline.messages.count
        state.loadOlderMessages(auth: AuthState(store: InMemoryTokenStore()))
        for _ in 0..<100 {
          if state.timeline.messages.count > before { break }
          try? await Task.sleep(for: .milliseconds(20))
        }
        try? await Task.sleep(for: .milliseconds(950))
      }
    } else {
'''+original+'    }\n'
 s=s[:begin]+scripted+s[end:]
 result_head='''    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    encoder.dateEncodingStrategy = .secondsSince1970
    let fingerprint = try! SHA256.hash(data: encoder.encode(Self.fixture(count))).map { String(format: "%02x", $0) }.joined()
    let result: [String: Any] = [
      "input_fingerprint_sha256": fingerprint,
      "fallback_measurements": HitchProbe.fallbackMeasurements,
      "shared_measurements": HitchProbe.sharedMeasurements,
      "publication_windows": HitchProbe.publications.map { published in
        let near = gaps.filter { $0.at >= published.0 - 0.05 && $0.at <= published.0 + 0.7 }
        return ["at_ms": ms(published.0), "messages": published.1, "max_gap_ms": (near.map(\\.ms).max() ?? 0).rounded()] as [String: Any]
      },'''
 parts=s.rsplit('    let result: [String: Any] = [',1)
 s=parts[0]+result_head+parts[1]
 entry.write_text(s)
 view=source/'Sokosumi/Chat/Timeline/RoomTimelineView.swift'
 t=view.read_text();seam='          preparedTranscript = waiting\n'
 if 'HitchProbe.publications.append' not in t:
  assert t.count(seam)==1;t=t.replace(seam,seam+'          HitchProbe.publications.append((ProcessInfo.processInfo.systemUptime, waiting.input.messages.count))\n')
 view.write_text(t)
 clamp=source/'Sokosumi/Chat/Rendering/ExpandableMessageBody.swift'
 t=clamp.read_text()
 if 'HitchProbe.fallbackMeasurements' not in t:
  assert t.count('          collapsedHeight = height')==1
  clamp.write_text(t.replace('          collapsedHeight = height','          collapsedHeight = height\n          HitchProbe.fallbackMeasurements += 1'))
 shared=source/'Sokosumi/Chat/Rendering/SharedMessageClampMeasurements.swift'
 if shared.exists():
  t=shared.read_text();assert t.count('action: { measured($0) }')==1
  shared.write_text(t.replace('action: { measured($0) }','action: { HitchProbe.sharedMeasurements += 1; measured($0) }'))
 scheme=source/'Sokosumi.xcodeproj/xcshareddata/xcschemes/Sokosumi.xcscheme'
 tree=ET.parse(scheme);action=tree.getroot().find('TestAction');action.set('shouldUseLaunchSchemeArgsEnv','NO')
 v=ET.SubElement(action,'EnvironmentVariables');ET.SubElement(v,'EnvironmentVariable',key='HITCH_INSPECT',value='1',isEnabled='YES');tree.write(scheme)
profile=root/'Profile.entitlements'
profile.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>\n')
if args.prepare_only:
 print(source, flush=True)
 sys.exit(0)
base = ['xcodebuild', '-workspace', str(source/'Sokosumi.xcworkspace'), '-scheme', 'Sokosumi', '-configuration', configuration, '-destination', 'platform=macOS,arch=arm64', '-skipPackagePluginValidation']
if os.environ.get('REPRO_DERIVED_DATA'):
 dd=Path(os.environ['REPRO_DERIVED_DATA']).expanduser().resolve()
else:
 import json
 settings=json.loads(subprocess.check_output(base+['-showBuildSettings','-json'],text=True))
 product=next(item['buildSettings'] for item in settings if item['target']=='Sokosumi')
 dd=Path(product['BUILD_DIR']).parents[1]
cmd=['xcodebuild','-workspace',str(source/'Sokosumi.xcworkspace'),'-scheme','Sokosumi','-configuration',configuration,'-destination','platform=macOS,arch=arm64','-skipPackagePluginValidation','-derivedDataPath',str(dd),'DEVELOPMENT_TEAM=GVWN7HXYJB','CODE_SIGN_STYLE=Manual','CODE_SIGN_IDENTITY=Developer ID Application: utxo AG (GVWN7HXYJB)','OTHER_CODE_SIGN_FLAGS=--timestamp=none','PROVISIONING_PROFILE_SPECIFIER=','SOKOSUMI_ENTITLEMENTS_GVWN7HXYJB='+str(profile),'PRODUCT_BUNDLE_IDENTIFIER=com.sokosumi.sharedclampprobe','ENABLE_CODE_COVERAGE=NO','CLANG_ENABLE_CODE_COVERAGE=NO','ONLY_ACTIVE_ARCH=YES']
if configuration=='Debug':cmd+=['build-for-testing']
else:cmd+=['build']
with (root/(configuration+'-build.log')).open('w') as log:subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True)
if configuration=='Release':
 app=root/'Sokosumi.app';shutil.copytree(dd/'Build/Products/Release/Sokosumi.app',app)
 subprocess.run(['codesign','--verify','--strict',str(app)],check=True)
 print(app,flush=True)
