-- SLA pause while a ticket waits on the client ("Awaiting End-user Response").
-- slaPausedAt: when the current pause began (null = clock running).
-- slaPausedSeconds: time already paused, added back when a priority change
-- re-derives the due date. No back-fill: a ticket already waiting when this
-- ships simply has no pause recorded. Idempotent.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "slaPausedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "slaPausedSeconds" INTEGER NOT NULL DEFAULT 0;
