import Foundation
import SokosumiChat
import Testing

/// Web voice messages: `.m4a` (Chrome, Safari) and `.weba` (Firefox) are audio cards; only MP4 plays natively.
struct VoiceMessageTests {
  @Test func webRecordingsAreAudioAttachments() throws {
    let m4aURL = try #require(URL(string: "https://blob.example/Voice%20message.m4a"))
    let webaURL = try #require(URL(string: "https://blob.example/Voice%20message.weba"))
    let m4a = try #require(MessageAttachment(url: m4aURL, label: "Voice message.m4a"))
    let weba = try #require(MessageAttachment(url: webaURL, label: "Voice message.weba"))
    #expect(m4a.kind == .audio)
    #expect(m4a.playsNatively)
    #expect(weba.kind == .audio)
    #expect(!weba.playsNatively)
  }

  @Test func aStandaloneVoiceLinkIsACardThatShowsItsTranscript() {
    let document = MessageMarkdown("[Voice message.m4a](https://blob.example/v.m4a)\n\n```transcript\nShip it Friday\n```")
    #expect(document.segments.first?.attachments.map(\.kind) == [.audio])
    #expect(document.showsVoiceTranscript)
  }

  @Test func aTranscriptFenceWithoutAudioStaysCode() {
    #expect(!MessageMarkdown("```transcript\nShip it Friday\n```").showsVoiceTranscript)
    #expect(!MessageMarkdown("[a.pdf](https://blob.example/a.pdf)\n\n```transcript\nx\n```").showsVoiceTranscript)
  }

  @Test func waveformScalesEachSlicesPeakToTheLoudest() {
    #expect(VoiceWaveform.peaks([0, 0.125, -0.5, 0.25, 0, 0], bars: 3) == [0.25, 1, 0])
    #expect(VoiceWaveform.peaks([], bars: 4).isEmpty)
    #expect(VoiceWaveform.peaks([0, 0, 0, 0], bars: 2) == [0, 0])
  }
}
