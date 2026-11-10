-- Update the client admin email to the Authenticator address.
-- Idempotent: the WHERE clause matches only if the old email is still set.
UPDATE "User"
SET email = 'svpcricket1995@gmail.com', "updatedAt" = NOW()
WHERE username = 'admin'
  AND email = 'admin@rbac.com';
