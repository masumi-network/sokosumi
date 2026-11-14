/// A voice message's waveform: loudness per bar, 0...1, from decoded samples. Web draws the same bars
/// (`voiceWaveformPeaks` in apps/web/src/lib/utils/voice-message.ts).
public enum VoiceWaveform {
  public static let bars = 40

  /// The peak of each slice, scaled so the loudest bar is 1. Silence stays 0.
  public static func peaks(_ samples: [Float], bars: Int = bars) -> [Float] {
    guard !samples.isEmpty, bars > 0 else { return [] }
    let step = Double(samples.count) / Double(bars)
    let peaks = (0 ..< bars).map { bar in
      let start = Int(Double(bar) * step)
      let end = min(samples.count, Int(Double(bar + 1) * step))
      return start < end ? samples[start ..< end].reduce(0) { max($0, abs($1)) } : 0
    }
    let loudest = peaks.max() ?? 0
    return loudest > 0 ? peaks.map { $0 / loudest } : peaks
  }
}
