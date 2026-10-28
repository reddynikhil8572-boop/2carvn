import { Prisma } from '@prisma/client';
import { withTenant } from '../db/tenantContext';
import type { TokenPayload } from '../utils/jwt';
import type { CreateClassInput, EnrolInput } from '../validators/class.validator';
import { teacherClassAccessFilter } from './courseAccess';

/**
 * Classes and enrolment — requirements §2.
 *
 * The class is how a course reaches a student (§6 delivery), so until this
 * existed the whole hierarchy could be built but never handed to anyone
 * through the API. Tests seeded classes directly to work around it.
 */

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const conflict = (m: string) => Object.assign(new Error(m), { statusCode: 409 });
const badRequest = (m: string) => Object.assign(new Error(m), { statusCode: 400 });

/**
 * School admins can read the school roster. Teachers receive only classes
 * assigned to them, including the legacy homeroom-teacher link.
 */
export const listClasses = async (user: TokenPayload) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return withTenant(user.schoolId!, async (tx) => {
    const classes = await tx.class.findMany({
      where: user.role === 'TEACHER' ? teacherClassAccessFilter(user) : undefined,
      orderBy: [{ academicYear: 'desc' }, { name: 'asc' }],
      include: {
        teacher: { select: { id: true, name: true } },
        teacherAllocations: {
          where: {
            isActive: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: today } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
            ],
          },
          select: { teacher: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { enrollments: true } },
      },
    });
    return classes.map(({ teacherAllocations, ...klass }) => ({
      ...klass,
      teacher: klass.teacher ?? teacherAllocations[0]?.teacher ?? null,
    }));
  });
};

export const createClass = async (user: TokenPayload, input: CreateClassInput) =>
  withTenant(user.schoolId!, async (tx) => {
    try {
      return await tx.class.create({
        data: {
          schoolId: user.schoolId!,
          name: input.name,
          academicYear: input.academicYear,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('A class with that name already exists for this academic year');
      }
      throw error;
    }
  });

/**
 * Enrols a student. Idempotent: enrolling someone already in the class returns
 * the existing row rather than erroring, because the caller's intent is
 * satisfied either way.
 */
export const enrolStudent = async (user: TokenPayload, classId: string, input: EnrolInput) =>
  withTenant(user.schoolId!, async (tx) => {
    const klass = await tx.class.findUnique({ where: { id: classId }, select: { id: true } });
    if (!klass) throw notFound('Class not found');

    const student = await tx.user.findFirst({
      where: { id: input.studentId, role: 'STUDENT' },
      select: { id: true },
    });
    if (!student) throw badRequest('No such student in this school');

    const existing = await tx.enrollment.findUnique({
      where: { classId_studentId: { classId, studentId: input.studentId } },
    });
    if (existing) return existing;

    return tx.enrollment.create({
      data: { schoolId: user.schoolId!, classId, studentId: input.studentId },
    });
  });

export const listEnrollments = async (user: TokenPayload, classId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    const klass = await tx.class.findFirst({
      where: {
        id: classId,
        ...(user.role === 'TEACHER' ? teacherClassAccessFilter(user) : {}),
      },
      select: { id: true },
    });
    if (!klass) throw notFound('Class not found');

    return tx.enrollment.findMany({
      where: { classId },
      include: { student: { select: { id: true, name: true, email: true } } },
      orderBy: { enrolledAt: 'asc' },
    });
  });
