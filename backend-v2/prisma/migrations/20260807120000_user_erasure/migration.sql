-- Marks a user row whose identifying details have been overwritten in response
-- to an erasure request.
--
-- A tombstone, not a deletion. `certificates.student_id` and
-- `courses.created_by` are ON DELETE RESTRICT on purpose, and quiz attempts and
-- submissions are academic records a school is generally required to retain —
-- so removing the row is both blocked and wrong. Overwriting the identifying
-- columns satisfies erasure while leaving the record intact but unattributable.
--
-- Nullable with no default: NULL means "never erased", which is the truth for
-- every existing row.
ALTER TABLE "users" ADD COLUMN "erased_at" TIMESTAMP(3);

-- Partial: erased users are a small minority and the only query that filters on
-- this asks for the erased ones.
CREATE INDEX "users_erased_at_idx" ON "users" ("erased_at") WHERE "erased_at" IS NOT NULL;

-- No new RLS policy and no new grant. `users` is already FORCE ROW LEVEL
-- SECURITY with a school_id policy, and a column added to an existing table
-- inherits both the policy and the table-level privileges already held by
-- edusphere_app. Adding a policy here would be a second, divergent definition
-- of the same boundary.
