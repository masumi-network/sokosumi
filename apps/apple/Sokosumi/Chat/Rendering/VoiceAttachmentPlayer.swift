import AVFoundation
import SokosumiChat
import SwiftUI

/// Web's compact voice card (`VoicePlayer`): play, a waveform decoded from the file (a plain track until then or
/// when it cannot be decoded), the time and a 1×, 1.5×, 2× speed. A format AVFoundation cannot open says so and
/// offers the browser instead of a player that never starts.
struct VoiceAttachmentPlayer: View {
  let attachment: MessageAttachment
  @State private var player: AVPlayer?
  @State private var playing = false
  @State private var current = 0.0
  @State private var duration = 0.0
  @State private var rate: Float = 1
  @State private var peaks: [Float] = []

  private static let rates: [Float] = [1, 1.5, 2]

  var body: some View {
    HStack(spacing: 8) {
      if attachment.playsNatively {
        Button(action: togglePlay) {
          Image(systemName: playing ? "pause.fill" : "play.fill")
            .frame(width: 28, height: 28)
            .background(.secondary.opacity(0.15), in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playing ? "Pause" : "Play \(attachment.filename)")
        track
        Text(Self.clock(playing || current > 0 ? current : duration))
          .font(.caption)
          .monospacedDigit()
          .foregroundStyle(.secondary)
        Button {
          rate = Self.rates[((Self.rates.firstIndex(of: rate) ?? 0) + 1) % Self.rates.count]
          player?.defaultRate = rate
          if playing {
            player?.rate = rate
          }
        } label: {
          Text("\(rate.formatted())×").font(.caption).monospacedDigit()
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Playback speed \(rate.formatted())×")
      } else {
        Image(systemName: "waveform").accessibilityHidden(true)
        Text("This recording's format can't play in the app.")
          .font(.callout)
          .foregroundStyle(.secondary)
        Link("Open in Browser", destination: attachment.url).font(.callout)
      }
    }
    .padding(8)
    .frame(maxWidth: 384, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.secondary.opacity(0.25)))
    .help(attachment.filename)
    // The waveform waits for the first Play: history rows nobody plays download nothing.
    .task(id: player != nil) { await loadWaveform() }
    .task(id: playing) { await followPlayback() }
    .onDisappear { player?.pause() }
  }

  private var progress: Double {
    duration > 0 ? min(1, current / duration) : 0
  }

  /// One Canvas: the bars are drawing, not views, and the played part follows `progress`.
  private var track: some View {
    GeometryReader { proxy in
      Canvas { context, size in
        let played = size.width * progress
        if peaks.isEmpty {
          let line = CGRect(x: 0, y: size.height / 2 - 2, width: size.width, height: 4)
          context.fill(Capsule().path(in: line), with: .style(.secondary.opacity(0.3)))
          context.fill(Capsule().path(in: CGRect(x: 0, y: line.minY, width: played, height: 4)), with: .style(.primary))
          return
        }
        let slot = size.width / CGFloat(peaks.count)
        for (index, peak) in peaks.enumerated() {
          let height = max(2, size.height * CGFloat(peak))
          let bar = CGRect(x: CGFloat(index) * slot, y: (size.height - height) / 2, width: max(1, slot - 1), height: height)
          context.fill(Capsule().path(in: bar), with: .style(bar.midX <= played ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary)))
        }
      }
      .contentShape(.rect)
      .onTapGesture { location in
        guard proxy.size.width > 0 else { return }
        seek(to: location.x / proxy.size.width * duration)
      }
    }
    .frame(height: 28)
    .frame(minWidth: 80)
    .accessibilityElement()
    .accessibilityLabel("Playback position")
    .accessibilityValue("\(Self.clock(current)) of \(Self.clock(duration))")
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: seek(to: current + 5)
      case .decrement: seek(to: current - 5)
      @unknown default: break
      }
    }
  }

  private func togglePlay() {
    #if os(iOS)
      // Voice plays with the silent switch on, like other media apps.
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    #endif
    let player = player ?? AVPlayer(url: attachment.url)
    self.player = player
    if playing {
      player.pause()
      playing = false
    } else {
      if duration > 0, current >= duration {
        player.seek(to: .zero)
      }
      player.defaultRate = rate
      player.play()
      playing = true
    }
  }

  private func seek(to seconds: Double) {
    guard duration > 0 else { return }
    let player = player ?? AVPlayer(url: attachment.url)
    self.player = player
    current = min(duration, max(0, seconds))
    player.seek(to: CMTime(seconds: current, preferredTimescale: 600))
  }

  /// ponytail: polls the clock ten times a second while playing; a periodic time observer if this ever shows up.
  private func followPlayback() async {
    while playing, !Task.isCancelled, let player {
      current = player.currentTime().seconds.isFinite ? player.currentTime().seconds : current
      if let item = player.currentItem, item.duration.seconds.isFinite, item.duration.seconds > 0 {
        duration = item.duration.seconds
      }
      if player.timeControlStatus == .paused, duration > 0, current >= duration - 0.05 {
        playing = false
        current = 0
        player.seek(to: .zero)
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
  }

  /// Recorded voice is at most two minutes (about 1 MB); longer or larger audio keeps the plain track.
  private nonisolated static let waveformMaxBytes = 3 * 1024 * 1024
  private nonisolated static let waveformMaxSeconds = 600.0
  /// AVAssetReader's lowest rate. Reading keeps one peak per 8 samples (1 kHz), so ten minutes is 600 000 floats.
  private nonisolated static let waveformSampleRate = 8000
  private nonisolated static let waveformDecimation = 8

  /// AVAssetReader reads only local files, so the waveform downloads the file once, under a byte cap.
  private func loadWaveform() async {
    guard player != nil, attachment.playsNatively, peaks.isEmpty,
          let file = try? await AttachmentDownload.fetch(attachment.url, maxBytes: Self.waveformMaxBytes) else { return }
    defer { try? FileManager.default.removeItem(at: file) }
    guard let decoded = await Self.decode(file), !Task.isCancelled else { return }
    peaks = VoiceWaveform.peaks(decoded.samples)
    if duration == 0 {
      duration = decoded.duration
    }
  }

  /// Mono peaks at 1 kHz from PCM resampled to 8 kHz, only for files up to ten minutes.
  /// Checked against a Chrome Opus-in-MP4 recording.
  @concurrent private nonisolated static func decode(_ file: URL) async -> (samples: [Float], duration: Double)? {
    let asset = AVURLAsset(url: file)
    guard let track = try? await asset.loadTracks(withMediaType: .audio).first,
          let length = try? await asset.load(.duration), length.seconds.isFinite, length.seconds <= waveformMaxSeconds,
          let reader = try? AVAssetReader(asset: asset) else { return nil }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: waveformSampleRate,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
      AVNumberOfChannelsKey: 1
    ])
    reader.add(output)
    guard reader.startReading() else { return nil }
    let limit = Int(waveformMaxSeconds) * waveformSampleRate / waveformDecimation
    var samples: [Float] = []
    while let buffer = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(buffer) {
      let size = CMBlockBufferGetDataLength(block)
      var chunk = [Float](repeating: 0, count: size / MemoryLayout<Float>.size)
      CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: size, destination: &chunk)
      for start in stride(from: 0, to: chunk.count, by: waveformDecimation) {
        samples.append(chunk[start ..< min(start + waveformDecimation, chunk.count)].reduce(0) { max($0, abs($1)) })
      }
      // A container that understates its duration still stops here.
      guard samples.count <= limit else {
        reader.cancelReading()
        return nil
      }
    }
    guard reader.status == .completed, !samples.isEmpty else { return nil }
    return (samples, length.seconds)
  }

  private static func clock(_ seconds: Double) -> String {
    let whole = seconds.isFinite ? max(0, Int(seconds)) : 0
    return "\(whole / 60):" + String(format: "%02d", whole % 60)
  }
}
