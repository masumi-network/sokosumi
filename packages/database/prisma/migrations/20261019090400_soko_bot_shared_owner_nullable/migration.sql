-- A project or workspace Soko Bot has no owner. The CHECKs
-- soko_bot_owner_scope_check and soko_bot_shared_room_owner_check already
-- keep a shared bot's scope consistent. No rollback past this point once a
-- shared bot exists: re-adding NOT NULL fails on its row.
ALTER TABLE "soko_bot" ALTER COLUMN "userId" DROP NOT NULL;
