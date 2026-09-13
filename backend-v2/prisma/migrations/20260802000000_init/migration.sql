-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SchoolPlan" AS ENUM ('BASIC', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "school_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "custom_domain" TEXT,
    "plan" "SchoolPlan" NOT NULL DEFAULT 'BASIC',
    "student_cap" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_school_code_key" ON "schools"("school_code");

-- CreateIndex
CREATE UNIQUE INDEX "schools_custom_domain_key" ON "schools"("custom_domain");

-- CreateIndex
CREATE INDEX "schools_is_active_idx" ON "schools"("is_active");

