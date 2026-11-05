-- One project timesheet entry per consultant · project · work item · day.
-- Fold every group of unapproved entries sharing a cell into its earliest entry:
-- hours summed, distinct notes joined, the strongest status kept
-- (DRAFT < SUBMITTED < REJECTED, as the weekly page ranks them), and the earliest
-- entry's frozen rate kept. Approved entries are never touched. Idempotent: a
-- second run finds no group and changes nothing. The work item is the task when
-- the entry names one, else its activity text (entries from before rows named a task).
WITH cells AS (
  SELECT "userId", "projectId",
         COALESCE("taskId", 'a:' || COALESCE(activity, '')) AS item,
         date,
         (array_agg(id ORDER BY "createdAt"))[1] AS keep_id,
         SUM(hours) AS total,
         string_agg(DISTINCT "workPerformed", '; ') AS notes,
         MAX(CASE status WHEN 'REJECTED' THEN 2 WHEN 'SUBMITTED' THEN 1 ELSE 0 END) AS rnk
  FROM "ProjectTimesheet"
  WHERE status <> 'APPROVED'
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
), kept AS (
  UPDATE "ProjectTimesheet" t
  SET hours = c.total,
      "workPerformed" = c.notes,
      status = CASE c.rnk WHEN 2 THEN 'REJECTED' WHEN 1 THEN 'SUBMITTED' ELSE 'DRAFT' END,
      "updatedAt" = now()
  FROM cells c
  WHERE t.id = c.keep_id
  RETURNING t.id
)
DELETE FROM "ProjectTimesheet" t
USING cells c
WHERE t.status <> 'APPROVED'
  AND t."userId" = c."userId"
  AND t."projectId" = c."projectId"
  AND COALESCE(t."taskId", 'a:' || COALESCE(t.activity, '')) = c.item
  AND t.date = c.date
  AND t.id <> c.keep_id;
