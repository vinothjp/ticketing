-- Sprints hold leaf work items only (Jira / Azure DevOps model): a summary item's sprints are
-- derived from the leaves beneath it, never stored on it. Idempotent — a second run updates 0 rows.

BEGIN;

-- 1. Push each summary item's sprint down to the backlog leaves beneath it (the nearest
--    assigned ancestor wins). A leaf already in a sprint keeps its own.
WITH RECURSIVE down AS (
  SELECT p.id, p."sprintId" AS sid, 0 AS depth
    FROM "ProjectTask" p
   WHERE p."sprintId" IS NOT NULL
     AND EXISTS (SELECT 1 FROM "ProjectTask" c WHERE c."parentTaskId" = p.id)
  UNION ALL
  SELECT c.id, d.sid, d.depth + 1
    FROM "ProjectTask" c JOIN down d ON c."parentTaskId" = d.id
),
nearest AS (
  SELECT DISTINCT ON (id) id, sid FROM down WHERE depth > 0 ORDER BY id, depth
)
UPDATE "ProjectTask" t
   SET "sprintId" = n.sid
  FROM nearest n
 WHERE t.id = n.id
   AND t."sprintId" IS NULL
   AND t."wbsType" <> 'PHASE'
   AND NOT EXISTS (SELECT 1 FROM "ProjectTask" c WHERE c."parentTaskId" = t.id);

-- 2. Summary items stop holding a sprint.
UPDATE "ProjectTask" p
   SET "sprintId" = NULL
 WHERE p."sprintId" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "ProjectTask" c WHERE c."parentTaskId" = p.id);

COMMIT;
