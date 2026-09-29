-- A project task's % complete is now derived from its status (TODO 0 · IN_PROGRESS 50 ·
-- REVIEW 80 · COMPLETED 100) instead of being typed. Re-derive every stored value so a task
-- that was reopened stops reading 100% (and rolling 100% up into its phase and project).
-- Idempotent — a second run updates 0 rows.
UPDATE "ProjectTask"
   SET "completionPct" = CASE "status"
         WHEN 'COMPLETED'   THEN 100
         WHEN 'REVIEW'      THEN 80
         WHEN 'IN_PROGRESS' THEN 50
         ELSE 0
       END
 WHERE "completionPct" IS DISTINCT FROM CASE "status"
         WHEN 'COMPLETED'   THEN 100
         WHEN 'REVIEW'      THEN 80
         WHEN 'IN_PROGRESS' THEN 50
         ELSE 0
       END;
