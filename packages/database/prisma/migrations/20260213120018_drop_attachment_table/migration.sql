/*
  Removes JobInput attachment table.
  File references are stored directly in JobInput.input as URLs.
*/

DROP TABLE IF EXISTS "attachment";
