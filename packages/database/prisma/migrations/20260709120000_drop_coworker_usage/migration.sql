/*
  Removes unused coworker_usage table (POST /coworkers/me/usage endpoint removed).
*/

DROP TABLE IF EXISTS "coworker_usage";
