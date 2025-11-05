-- Ensure "Others" category exists (create if missing)
INSERT INTO "Category" ("id", "createdAt", "updatedAt", "name", "slug", "priority")
SELECT 
  gen_random_uuid()::text,
  NOW(),
  NOW(),
  'Others',
  'default',
  100
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" WHERE "slug" = 'default'
);

-- Assign default category to all agents without categories
INSERT INTO "_AgentCategory" ("A", "B")
SELECT 
  "Agent"."id",
  (SELECT "id" FROM "Category" WHERE "slug" = 'default' LIMIT 1)
FROM "Agent"
WHERE NOT EXISTS (
  SELECT 1 FROM "_AgentCategory" WHERE "_AgentCategory"."A" = "Agent"."id"
);

