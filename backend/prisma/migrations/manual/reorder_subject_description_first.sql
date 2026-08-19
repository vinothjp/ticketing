-- Subject and Description lead every ticket form.
--
-- The Create Ticket form used to render fixed sections (Ticket Info -> Ticket Detail ->
-- Root Cause), which pushed Subject/Description (ticket_detail) below Priority
-- (ticket_info) no matter how an admin ordered them in the Template Designer. The form
-- now honours TemplateField."sortOrder" top to bottom, so existing templates need their
-- stored order corrected once.
--
-- Idempotent: re-running is a no-op once the order is already correct. Every other field
-- keeps its relative position.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "templateId"
      ORDER BY
        CASE "fieldKey"
          WHEN 'subject' THEN 0
          WHEN 'description' THEN 1
          -- Attachments joins the description block: it is a ticket_detail field, and
          -- leaving it stranded further down splits that group's heading in two.
          WHEN 'attachments' THEN 2
          ELSE 3
        END,
        "sortOrder",
        "createdAt"
    ) - 1 AS new_order
  FROM "TemplateField"
)
UPDATE "TemplateField" f
SET "sortOrder" = r.new_order
FROM ranked r
WHERE f.id = r.id
  AND f."sortOrder" IS DISTINCT FROM r.new_order;
