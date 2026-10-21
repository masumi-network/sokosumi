-- Agent-created Social posts wait here until a person approves them.
-- IF NOT EXISTS: preview databases may already hold this value from the
-- branch's earlier migration name.
ALTER TYPE "SocialPostStatus" ADD VALUE IF NOT EXISTS 'NEEDS_APPROVAL';
