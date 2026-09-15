import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { asSuperAdmin, withTenant } from '../db/tenantContext';
import { hashPassword } from '../services/auth.service';
import { requestReset } from '../services/passwordReset.service';
import { successResponse } from '../utils/responseFormat';
import { logger } from '../utils/logger';
import type { CreateSchoolInput, CreateUserInput } from '../validators/auth.validator';

/** Student caps per requirements §16. */
const PLAN_CAPS: Record<string, number | null> = {
  BASIC: 500,
  STANDARD: 2000,
  PROFESSIONAL: 10000,
  ENTERPRISE: null, // unlimited
};

/**
 * POST /api/v1/super-admin/schools
 *
 * Requirements §3: the platform owner onboards an institution, a unique School
 * ID is generated, **and the school gets its first administrator**.
 *
 * The admin is created here rather than in a second call because the two are
 * one operation: a school without an admin is a school nobody can log into, and
 * the provisioning flow would be left half-finished with no way to complete it
 * through the API. Both rows are written in a single transaction, so a failure
 * creating the admin does not leave an orphaned school behind.
 *
 * The platform owner does not have to choose the customer's password. Omit it
 * and the account is created with an unusable hash and a reset link is emailed,
 * so a credential for someone else's staff never passes through here.
 */
export const createSchool = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const input = req.body as CreateSchoolInput;
    const plan = input.plan ?? 'BASIC';

    // A password the caller did not choose is replaced by random bytes that are
    // hashed and immediately discarded. The account therefore exists, occupies
    // its email address, and cannot be logged into until a reset completes —
    // rather than being left with a guessable or empty credential.
    const chosenPassword = input.admin.password;
    const passwordHash = await hashPassword(
      chosenPassword ?? crypto.randomBytes(32).toString('base64url')
    );

    const { school, admin } = await asSuperAdmin(async (tx) => {
      const created = await tx.school.create({
        data: {
          schoolCode: input.schoolCode,
          name: input.name,
          city: input.city,
          plan,
          studentCap: PLAN_CAPS[plan] ?? null,
          primaryColor: input.primaryColor,
          customDomain: input.customDomain,
        },
      });

      const firstAdmin = await tx.user.create({
        data: {
          schoolId: created.id,
          email: input.admin.email,
          passwordHash,
          name: input.admin.name,
          role: 'SCHOOL_ADMIN',
        },
        select: { id: true, email: true, name: true, role: true },
      });

      await tx.auditLog.create({
        data: {
          schoolId: created.id,
          actorId: req.user!.userId,
          action: 'SCHOOL_PROVISIONED',
          entity: 'School',
          entityId: created.id,
          metadata: {
            schoolCode: created.schoolCode,
            plan,
            adminId: firstAdmin.id,
            // Recorded because "who set this password" matters when an account
            // is later disputed.
            passwordSetBy: chosenPassword ? 'platform_owner' : 'reset_link',
          },
        },
      });

      return { school: created, admin: firstAdmin };
    });

    // Outside the transaction: a mail failure must not roll back a school that
    // was successfully created. requestReset never throws to its caller.
    if (!chosenPassword) {
      await requestReset(school.schoolCode, admin.email);
    }

    logger.info(
      `School provisioned: ${school.schoolCode} (${school.name}) with admin ${admin.email}`
    );

    res.status(201).json(
      successResponse(
        {
          ...school,
          admin,
          // The client cannot infer this from the payload, and it changes what
          // the UI should tell the operator to do next.
          adminMustResetPassword: !chosenPassword,
        },
        'School created with its first administrator'
      )
    );
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/super-admin/schools */
export const listSchools = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const schools = await asSuperAdmin((tx) =>
      tx.school.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true } } },
      })
    );

    res.status(200).json(
      successResponse(
        schools.map(({ _count, ...school }) => ({ ...school, userCount: _count.users })),
        'Schools fetched'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/school-admin/users
 * Creates staff or learners inside the caller's own school. The school is
 * taken from the token, never from the request body — a school admin cannot
 * name a different tenant, and RLS would reject it even if they tried.
 */
export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const schoolId = req.user!.schoolId!;
    const input = req.body as CreateUserInput;

    // Same treatment as createSchool above: a password the caller did not
    // choose is random bytes, hashed and immediately discarded. The account
    // exists and holds its email address, and cannot be logged into until a
    // reset completes — rather than carrying a weak credential an administrator
    // invented on the spot for someone else.
    const chosenPassword = input.password;
    const passwordHash = await hashPassword(
      chosenPassword ?? crypto.randomBytes(32).toString('base64url')
    );

    const { user, schoolCode } = await withTenant(schoolId, async (tx) => {
      const school = await tx.school.findUnique({
        where: { id: schoolId },
        // schoolCode is needed for the reset link: resetting is school-scoped,
        // because the same address can belong to a different person elsewhere.
        select: { studentCap: true, schoolCode: true },
      });

      // §16 — enforce the plan's student cap.
      if (input.role === 'STUDENT' && school?.studentCap != null) {
        const students = await tx.user.count({ where: { schoolId, role: 'STUDENT' } });
        if (students >= school.studentCap) {
          throw Object.assign(
            new Error(`Student limit of ${school.studentCap} reached for this plan`),
            { statusCode: 409 }
          );
        }
      }

      const created = await tx.user.create({
        data: {
          schoolId,
          email: input.email,
          passwordHash,
          name: input.name,
          role: input.role,
        },
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
      });

      await tx.auditLog.create({
        data: {
          schoolId,
          actorId: req.user!.userId,
          action: 'USER_CREATED',
          entity: 'User',
          entityId: created.id,
          // Recorded because "who set this password" matters when an account is
          // later disputed — the same reasoning as SCHOOL_PROVISIONED.
          metadata: {
            role: created.role,
            passwordSetBy: chosenPassword ? 'school_admin' : 'reset_link',
          },
        },
      });

      return { user: created, schoolCode: school?.schoolCode ?? null };
    });

    // Outside the transaction: a mail failure must not roll back a user that
    // was successfully created or make the browser wait for SMTP.
    if (!chosenPassword && schoolCode) {
      void requestReset(schoolCode, user.email).catch((error) => {
        // The account is valid even when delivery is temporarily unavailable.
        // The administrator can resend a reset from the normal forgot-password flow.
        logger.error({ error, email: user.email }, 'Student password setup email failed');
      });
    }

    res.status(201).json(
      successResponse(
        {
          ...user,
          // The client cannot infer this from the payload, and it changes what
          // the UI tells the administrator to do next.
          mustSetPassword: !chosenPassword,
        },
        chosenPassword ? 'User created' : 'User created and sent a set-password link'
      )
    );
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/school-admin/users — scoped to the caller's school by RLS. */
export const listUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const users = await withTenant(req.user!.schoolId!, (tx) =>
      tx.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          lastLoginAt: true,
          // So the list can mark tombstones. Without it the UI shows an
          // "Erased user" row that looks like an oddly-named account.
          erasedAt: true,
          createdAt: true,
        },
      })
    );

    res.status(200).json(successResponse(users, 'Users fetched'));
  } catch (error) {
    next(error);
  }
};
