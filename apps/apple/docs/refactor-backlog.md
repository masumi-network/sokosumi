# Apple refactor backlog

Architecture work deferred until after the Mac 1.0.0 release. Re-audit current `main` before starting an item; there is no Task for these.

- **Notifications and room membership onto `GatedChannel`.** Presence (`OrgPresenceChannel`) and typing (`RoomTypingChannel`) already run on the `GatedChannel` engine in `SokosumiRealtime`; `RoomMembershipSubscriptions` and the user notifications channel in `AblyRealtimeConnection` still carry their own authorize and retry logic. Moving membership includes deciding its fail-open policy.
- **A composer session for iOS.** One portable session in `SokosumiChat` that the Mac and a future iOS composer both drive, built on the existing `Composer*` models.
