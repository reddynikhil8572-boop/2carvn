CREATE TYPE "PublicEnquiryKind" AS ENUM ('GENERAL', 'DEMO');
CREATE TYPE "PublicEnquiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED');

CREATE TABLE "public_enquiries" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "organisation" TEXT,
  "kind" "PublicEnquiryKind" NOT NULL DEFAULT 'GENERAL',
  "message" TEXT NOT NULL,
  "consent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "PublicEnquiryStatus" NOT NULL DEFAULT 'NEW',
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_enquiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_enquiries_message_check" CHECK (length(btrim("message")) BETWEEN 10 AND 4000),
  CONSTRAINT "public_enquiries_name_check" CHECK (length(btrim("name")) BETWEEN 2 AND 120)
);

CREATE INDEX "public_enquiries_status_submitted_at_idx"
  ON "public_enquiries"("status", "submitted_at" DESC);

GRANT SELECT, INSERT, UPDATE ON TABLE "public_enquiries" TO edusphere_app;
ALTER TABLE "public_enquiries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public_enquiries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "public_enquiries_submit_new" ON "public_enquiries"
  FOR INSERT WITH CHECK ("status" = 'NEW');
CREATE POLICY "public_enquiries_admin_read" ON "public_enquiries"
  FOR SELECT USING (app_is_super_admin());
CREATE POLICY "public_enquiries_admin_update" ON "public_enquiries"
  FOR UPDATE USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

-- Only published catalog entries are public. Other course data remains
-- tenant- and role-scoped by the existing policies.
CREATE POLICY "courses_public_catalog" ON "courses"
  FOR SELECT USING ("status" = 'PUBLISHED');
