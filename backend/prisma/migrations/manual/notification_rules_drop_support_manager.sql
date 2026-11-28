-- "Support manager" (the project manager, else the Admins) was withdrawn from the
-- Email Configuration: the project manager is the client product's own, never the
-- Admins. Saved rules naming it now name PROJECT_MANAGER. Idempotent.
UPDATE "NotificationRule"
SET recipients = (
  SELECT array_agg(DISTINCT r) FROM unnest(array_replace(recipients, 'SUPPORT_MANAGER', 'PROJECT_MANAGER')) AS r
)
WHERE 'SUPPORT_MANAGER' = ANY(recipients);
