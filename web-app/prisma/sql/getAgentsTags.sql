SELECT DISTINCT "tag"
FROM (
    SELECT unnest(array_cat("onChainTags", "overrideTags")) AS "tag"
    FROM "Agent"
)
WHERE "tag" IS NOT NULL
ORDER BY "tag";