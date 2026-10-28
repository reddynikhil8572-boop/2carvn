# 2CaRvN Platform Audit and Delivery Checklist

Audit baseline: 2026-10-28

## 1. Current technology stack

- Frontend: React 18, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, and Radix-based UI primitives.
- Backend: Express 5 and TypeScript.
- Persistence: PostgreSQL with Prisma 6 and hand-written migrations for database features Prisma does not model, including row-level security.
- Authentication: school-code/email/password login, HTTP-only access and refresh cookies, rotating refresh tokens, password recovery, and optional TOTP two-factor authentication.
- File storage: direct-to-object-storage uploads coordinated by the API; the repository includes storage signing, upload confirmation, and malware-scanning boundaries.
- Deployment: Vercel frontend and Render API configuration are present. The API also supports Redis and email configuration.

## 2. Existing pages and routes

The authenticated frontend currently provides dashboard, courses and course authoring/learning, classes, users and students, assignments and submissions, quizzes, certificates, settings/security, school administration, and teacher allocations. Authentication routes include login, password recovery/reset, and two-factor setup/verification. The root route redirects to login or the authenticated user's dashboard; a complete public marketing website is not present.

The API currently mounts authentication, platform-admin, school-admin, teacher-allocation, class, course hierarchy, assignment/submission, assessment, video, and certificate endpoints. Public certificate verification is intentionally separate from authenticated certificate operations.

## 3. Database and authentication architecture

The current data model is a shared PostgreSQL schema with school-scoped records and database-enforced row-level security. Most tenant operations run through a transaction that sets tenant context; the cross-tenant platform-admin path has a separate explicit context.

The application role model is now `ADMIN`, `ORGANISER`, `TEACHER`, `STUDENT`, and `COORDINATOR`. A migration maps legacy roles and suspends legacy parent accounts, and division assignments now scope coordinator summaries on the server. These changes are implemented in code but still need database-backed migration and integration verification.

## 4. Working functionality to preserve

- Secure login/session refresh, password reset, account lockout, optional two-factor authentication, and security settings.
- School isolation policies and tenant-aware backend operations.
- Course hierarchy and authoring, student learning, video progress, quizzes, assignments/submissions, and certificates.
- Class/student management, upload/storage integration, operational health endpoints, and audit logging.
- Teacher assignment, availability, timetable conflict checks, school-admin assignment requests, and assignment change history.
- Existing deployment configuration, branded assets where present, and the established application navigation/layout.

## 5. Missing requirements

- Dedicated role-specific login entry points and onboarding flows.
- Coordinator payment-status workflows and financially restricted reports; the role migration and read-only division-scoped summary are in code, but the migration has not yet been applied to a database.
- Fee schedules, instalments, payment claims, secure receipt handling, verification/refund records, and coordinator-safe payment status workflows.
- Application messaging, notifications, content notebooks/notes, and safeguarding/moderation workflows.
- Student game integration boundary and richer learning-path/achievement experience.
- Full role-specific reporting/exports, end-to-end coverage for the requested workflows, and production verification.

## 6. Security and data-integrity risks to address

- Legacy parent accounts must remain suspended for manual review; the migration preserves their linked records, revokes refresh sessions, and grants no coordinator divisions. This still needs database-backed verification.
- The five-role checks are updated across the API and frontend; regression tests must continue to verify that the role rename did not weaken route authorization.
- Division grants and server-derived coordinator query scope are implemented, but database policies and migrations still need integration testing.
- The tenant model remains school-based, with coordinator division scope layered on top. Do not rely on client-provided school filters for coordinator access.
- Existing cookie/JWT behavior should be reviewed for role/status changes, session revocation, and CSRF protections as part of the role migration. These are review items, not claims that a tested exploit exists.
- Receipt data will require private storage, content/type/size validation, scoped downloads, and immutable verification/audit records before payment workflows are enabled.
- Database integration tests require a reachable PostgreSQL test service. The most recent attempt could not connect to the configured local test endpoint.

## 7. Recommended implementation sequence

| Phase | Scope | Status |
|---|---|---|
| A | Repository audit, migration risks, and phased checklist | Complete |
| B | Brand tokens, shared foundations, five-role migration, division scope, and permission tests | Code implemented; DB migration and integration verification pending |
| C | Public website and enquiry workflows | Public pages, published-course catalogue, persistent enquiry intake, and Admin triage implemented; DB migration and integration verification pending |
| D | Admin and organiser workflows, enrolments, payments, and reporting | Enquiry triage implemented; enrolment, payment, and reporting workflows not started |
| E | Coordinator dashboard and division-limited status operations | Read-only division-scoped summary implemented; status operations not started |
| F | Teacher portal enhancements and authorised communication | Core teacher-allocation workflows implemented; broader portal and communication features not started |
| G | Student learning experience, notes, notifications, and game boundary | Not started |
| H | Four student themes, sound, motion, and accessibility settings | Frontend implementation/build and targeted role tests passed; browser interaction and accessibility audit pending |
| I | Reporting, security regression tests, accessibility, and performance verification | Not started |
| J | Production configuration, migrations, backups, storage, and deployment documentation | Not started |

### Phase B migration guardrails

1. Rename legacy `SUPER_ADMIN` and `SCHOOL_ADMIN` accounts to `ADMIN` and `ORGANISER` respectively, preserving their school-boundary semantics.
2. Suspend existing `PARENT` accounts for manual review; never infer that they are students or coordinators. Preserve linked records.
3. Add coordinator division assignments and enforce them in the backend before exposing coordinator data.
4. Update schema, migrations, tokens, validation, server route guards, frontend types, navigation, seed data, and tests together.
5. Apply the migration only through the normal deployment migration process after backup and review; do not run it against production from this development task.

### Implemented in the current foundation increment

- Updated Prisma, JWT, backend route guards, user provisioning validation, frontend role types, navigation, and role labels to the five requested role names.
- Added a migration that suspends legacy parent accounts, retains their relationship data, revokes refresh sessions, bumps token versions, and maps the legacy role labels without granting active coordinator access.
- Added division, coordinator-grant, and revocation-history models plus Admin endpoints and an Admin management page.
- Added an authenticated coordinator summary limited to active grants. The summary contains school/class/student counts and excludes financial amounts.
- Added `/admin` and `/organiser` API prefixes while retaining existing legacy API prefixes for compatibility.
- Added public landing, about, course catalogue, programmes, and contact pages. Public catalogue results expose published courses only.
- Added a rate-limited contact/demo form, database persistence, public-insert-only RLS policy, and Admin-only enquiry review/status management.

The migration has **not** been run against the configured PostgreSQL database. The test database was previously unavailable, so migration execution and DB-backed authorization tests remain unverified.
