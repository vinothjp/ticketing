-- A summary WBS item's status now follows its children (ProjectsService.rollupStatus):
--   all COMPLETED → COMPLETED; all TODO → TODO; all REVIEW/COMPLETED → REVIEW;
--   anything else → IN_PROGRESS.
-- Before this, a parent's status was typed by hand and never updated, so a parent
-- could read In Progress with every sub-task completed (or Completed with sub-tasks
-- reopened beneath it). This brings existing rows into line.
--
-- Runs pass after pass until nothing changes, so a change at the bottom of a deep
-- tree reaches the top. Idempotent: re-running reports "0 parent(s) corrected".
-- completionPct / completedAt follow the status the same way the service sets them.

DO $$
DECLARE
  n int;
  total int := 0;
  passes int := 0;
BEGIN
  LOOP
    WITH kids AS (
      SELECT c."parentTaskId" AS id,
             CASE
               WHEN bool_and(c.status = 'COMPLETED')               THEN 'COMPLETED'
               WHEN bool_and(c.status = 'TODO')                    THEN 'TODO'
               WHEN bool_and(c.status IN ('REVIEW', 'COMPLETED'))  THEN 'REVIEW'
               ELSE 'IN_PROGRESS'
             END AS derived
      FROM "ProjectTask" c
      WHERE c."parentTaskId" IS NOT NULL
      GROUP BY c."parentTaskId"
    )
    UPDATE "ProjectTask" p
    SET status          = k.derived,
        "completionPct" = CASE k.derived WHEN 'COMPLETED' THEN 100 WHEN 'REVIEW' THEN 80
                                         WHEN 'IN_PROGRESS' THEN 50 ELSE 0 END,
        "completedAt"   = CASE WHEN k.derived = 'COMPLETED' THEN COALESCE(p."completedAt", now()) ELSE NULL END,
        "updatedAt"     = now()
    FROM kids k
    WHERE p.id = k.id AND p.status IS DISTINCT FROM k.derived;

    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    passes := passes + 1;
    EXIT WHEN n = 0 OR passes >= 50;  -- a real WBS is a few levels deep; the cap guards a bad parent loop
  END LOOP;
  RAISE NOTICE '% parent(s) corrected', total;
END $$;
