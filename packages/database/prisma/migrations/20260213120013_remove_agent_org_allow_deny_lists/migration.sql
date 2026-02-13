-- Remove organization-based allow/deny list join tables for agents
DROP TABLE IF EXISTS "_AgentBlacklist";
DROP TABLE IF EXISTS "_AgentToOrganization";
