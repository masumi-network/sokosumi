-- Banner while focused: let the OS banner through while a Sokosumi page is focused (SOK-957).
-- Delivery, unlike showRoomUnreadCount: the push worker suppresses its banner on a focused
-- page, and the banner is the only thing that makes a sound, so this is how a reader asks to
-- hear a notification while the app is open. Defaults false, so no reader starts seeing a
-- banner they did not ask for.

ALTER TABLE "user" ADD COLUMN "bannerWhileFocused" BOOLEAN NOT NULL DEFAULT false;
