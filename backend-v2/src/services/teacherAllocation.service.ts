import { Prisma } from '@prisma/client';
import { asSuperAdmin, withTenant, type TenantClient } from '../db/tenantContext';
import type { TokenPayload } from '../utils/jwt';
import type {
  AvailabilityInput,
  CreateAllocationRequestInput,
  CreateTeacherAllocationInput,
  CreateTimetableSlotInput,
  DecideAllocationRequestInput,
  UpdateTeacherAllocationInput,
} from '../validators/teacherAllocation.validator';

const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const forbidden = (message: string) => Object.assign(new Error(message), { statusCode: 403 });
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

const dateValue = (value: string | null | undefined): Date | null | undefined => {
  if (value === undefined || value === null) return value;
  return new Date(`${value}T00:00:00.000Z`);
};

const asDateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const rangesOverlap = (
  startA: Date | null,
  endA: Date | null,
  startB: Date | null,
  endB: Date | null,
) => (!endA || !startB || startB <= endA) && (!endB || !startA || startA <= endB);

const activeOnDateWhere = (today: Date) => ({
  isActive: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: today } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
  ],
});

const assignmentSnapshot = (allocation: {
  id: string;
  schoolId: string;
  teacherId: string;
  classId: string;
  subject: string;
  section: string;
  weeklyHours: number;
  startsAt: Date | null;
  endsAt: Date | null;
  substituteForId: string | null;
  isActive: boolean;
}) => ({
  ...allocation,
  startsAt: asDateOnly(allocation.startsAt),
  endsAt: asDateOnly(allocation.endsAt),
});

const writeAudit = (
  tx: TenantClient,
  user: TokenPayload,
  schoolId: string,
  action: string,
  entity: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
) =>
  tx.auditLog.create({
    data: {
      schoolId,
      actorId: user.userId,
      action,
      entity,
      entityId,
      metadata,
    },
  });

const requireTeacherAndClass = async (
  tx: TenantClient,
  schoolId: string,
  teacherId: string,
  classId: string,
) => {
  const [teacher, klass] = await Promise.all([
    tx.user.findFirst({
      where: { id: teacherId, schoolId, role: 'TEACHER', status: 'ACTIVE' },
      select: { id: true },
    }),
    tx.class.findFirst({ where: { id: classId, schoolId }, select: { id: true } }),
  ]);
  if (!teacher) throw badRequest('Choose an active teacher in this school');
  if (!klass) throw badRequest('Choose a class in this school');
};

const deactivateAllocation = async (tx: TenantClient, schoolId: string, allocationId: string) => {
  const result = await tx.teacherAllocation.updateMany({
    where: { id: allocationId, schoolId, isActive: true },
    data: { isActive: false },
  });
  if (result.count !== 1) throw conflict('This teacher allocation is no longer active');
  return tx.teacherAllocation.findUniqueOrThrow({ where: { id: allocationId } });
};

const scoped = <T>(user: TokenPayload, schoolId: string, fn: (tx: TenantClient) => Promise<T>) => {
  if (user.role === 'ADMIN') return asSuperAdmin(fn);
  if (!user.schoolId || user.schoolId !== schoolId) {
    throw forbidden('You may only access allocations in your own school');
  }
  return withTenant(schoolId, fn);
};

export const listWorkspace = async (user: TokenPayload, schoolId: string) =>
  scoped(user, schoolId, async (tx) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [teachers, classes, allocations, requests, availabilities, courses] = await Promise.all([
      tx.user.findMany({
        where: { schoolId, role: 'TEACHER', status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      tx.class.findMany({
        where: { schoolId },
        select: { id: true, name: true, academicYear: true, teacherId: true },
        orderBy: [{ academicYear: 'desc' }, { name: 'asc' }],
      }),
      tx.teacherAllocation.findMany({
        where: { schoolId },
        include: {
          teacher: { select: { id: true, name: true, email: true } },
          class: {
            select: {
              id: true,
              name: true,
              academicYear: true,
              enrollments: {
                select: { student: { select: { id: true, name: true, email: true } } },
              },
            },
          },
          timetableSlots: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
          substituteFor: { select: { id: true, teacher: { select: { id: true, name: true } } } },
        },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      }),
      tx.teacherAllocationRequest.findMany({
        where: { schoolId },
        include: {
          requester: { select: { id: true, name: true } },
          reviewer: { select: { id: true, name: true } },
          teacher: { select: { id: true, name: true } },
          class: { select: { id: true, name: true, academicYear: true } },
          allocation: { select: { id: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
      tx.teacherAvailability.findMany({
        where: { schoolId },
        orderBy: [{ teacherId: 'asc' }, { weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      tx.course.findMany({
        where: { schoolId, subject: { not: null }, assignments: { some: {} } },
        select: {
          id: true,
          title: true,
          subject: true,
          assignments: { select: { classId: true, class: { select: { name: true } } } },
        },
      }),
    ]);

    const activeAllocations = allocations.filter(
      (allocation) =>
        allocation.isActive &&
        (!allocation.startsAt || allocation.startsAt <= today) &&
        (!allocation.endsAt || allocation.endsAt >= today),
    );
    const warnings: Array<{ code: string; message: string; entityId?: string }> = [];
    const allocationsByTeacher = new Map<string, typeof activeAllocations>();
    for (const allocation of activeAllocations) {
      const current = allocationsByTeacher.get(allocation.teacherId) ?? [];
      current.push(allocation);
      allocationsByTeacher.set(allocation.teacherId, current);
    }

    for (const teacher of teachers) {
      const hours = (allocationsByTeacher.get(teacher.id) ?? []).reduce(
        (total, allocation) => total + allocation.weeklyHours,
        0,
      );
      if (hours > 40) {
        warnings.push({
          code: 'EXCESSIVE_WORKLOAD',
          entityId: teacher.id,
          message: `${teacher.name} is assigned ${hours} hours per week (recommended maximum: 40).`,
        });
      }
    }

    const assignedClassIds = new Set([
      ...activeAllocations.map((allocation) => allocation.classId),
      ...classes.filter((klass) => klass.teacherId).map((klass) => klass.id),
    ]);
    for (const klass of classes) {
      if (!assignedClassIds.has(klass.id)) {
        warnings.push({
          code: 'UNASSIGNED_CLASS',
          entityId: klass.id,
          message: `${klass.name} has no assigned teacher.`,
        });
      }
    }

    const allocationSubjects = new Set(
      activeAllocations.map((allocation) => `${allocation.classId}:${allocation.subject.trim().toLowerCase()}`),
    );
    for (const course of courses) {
      for (const courseAssignment of course.assignments) {
        const subjectKey = `${courseAssignment.classId}:${course.subject!.trim().toLowerCase()}`;
        if (!allocationSubjects.has(subjectKey)) {
          warnings.push({
            code: 'UNSTAFFED_SUBJECT',
            entityId: course.id,
            message: `${course.subject} has no teacher assigned in ${courseAssignment.class.name}.`,
          });
        }
      }
    }

    return { schoolId, teachers, classes, allocations, requests, availabilities, warnings };
  });

export const listMyAllocations = async (user: TokenPayload) => {
  if (user.role !== 'TEACHER' || !user.schoolId) {
    throw forbidden('Only teachers can view their personal allocation schedule');
  }
  return withTenant(user.schoolId, async (tx) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [allocations, availability] = await Promise.all([
      tx.teacherAllocation.findMany({
        where: {
          schoolId: user.schoolId!,
          teacherId: user.userId,
          isActive: true,
          OR: [{ endsAt: null }, { endsAt: { gte: today } }],
        },
        include: {
          class: {
            select: {
              id: true,
              name: true,
              academicYear: true,
              enrollments: {
                select: { student: { select: { id: true, name: true, email: true } } },
              },
            },
          },
          timetableSlots: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
          substituteFor: { select: { id: true, teacher: { select: { id: true, name: true } } } },
        },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.teacherAvailability.findMany({
        where: { schoolId: user.schoolId!, teacherId: user.userId },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
    ]);
    return { allocations, availability };
  });
};

const createAllocation = async (
  tx: TenantClient,
  user: TokenPayload,
  schoolId: string,
  input: CreateTeacherAllocationInput,
) => {
  await requireTeacherAndClass(tx, schoolId, input.teacherId, input.classId);
  let replacement: Awaited<ReturnType<typeof tx.teacherAllocation.findFirst>> = null;
  if (input.replacesAllocationId) {
    replacement = await tx.teacherAllocation.findFirst({
      where: { id: input.replacesAllocationId, schoolId, isActive: true },
    });
    if (!replacement) throw badRequest('The assignment to replace must be active in this school');
  }
  if (input.substituteForId) {
    const target = await tx.teacherAllocation.findFirst({
      where: { id: input.substituteForId, schoolId, classId: input.classId, isActive: true },
      select: { id: true },
    });
    if (!target) throw badRequest('The substitution target must be an active allocation in the selected class');
  }

  if (replacement) {
    const oldSnapshot = assignmentSnapshot(replacement);
    const deactivated = await deactivateAllocation(tx, schoolId, replacement.id);
    await writeAudit(
      tx,
      user,
      schoolId,
      'TEACHER_ALLOCATION_REASSIGNED',
      'TeacherAllocation',
      replacement.id,
      { old: oldSnapshot, new: assignmentSnapshot(deactivated) },
    );

    const oldClass = await tx.class.findFirst({
      where: { id: replacement.classId, teacherId: replacement.teacherId },
      select: { id: true },
    });
    if (oldClass) {
      await tx.class.update({
        where: { id: oldClass.id },
        data: { teacherId: replacement.classId === input.classId ? input.teacherId : null },
      });
    }
  }

  const allocation = await tx.teacherAllocation.create({
    data: {
      schoolId,
      teacherId: input.teacherId,
      classId: input.classId,
      subject: input.subject,
      section: input.section,
      weeklyHours: input.weeklyHours,
      startsAt: dateValue(input.startsAt),
      endsAt: dateValue(input.endsAt),
      substituteForId: input.substituteForId,
    },
  });
  await writeAudit(
    tx,
    user,
    schoolId,
    replacement ? 'TEACHER_ALLOCATION_REPLACEMENT_CREATED' : 'TEACHER_ALLOCATION_CREATED',
    'TeacherAllocation',
    allocation.id,
    {
      old: replacement ? assignmentSnapshot(replacement) : null,
      new: assignmentSnapshot(allocation),
    },
  );
  return allocation;
};

export const createAllocationAsAdmin = async (
  user: TokenPayload,
  schoolId: string,
  input: CreateTeacherAllocationInput,
) => {
  if (user.role !== 'ADMIN') throw forbidden('Only a platform administrator may change allocations directly');
  return scoped(user, schoolId, (tx) => createAllocation(tx, user, schoolId, input));
};

export const updateAllocationAsAdmin = async (
  user: TokenPayload,
  schoolId: string,
  allocationId: string,
  input: UpdateTeacherAllocationInput,
) => {
  if (user.role !== 'ADMIN') throw forbidden('Only a platform administrator may change allocations directly');
  return scoped(user, schoolId, async (tx) => {
    const existing = await tx.teacherAllocation.findFirst({ where: { id: allocationId, schoolId } });
    if (!existing) throw notFound('Teacher allocation not found');
    const updateData = {
      subject: input.subject,
      section: input.section,
      weeklyHours: input.weeklyHours,
      startsAt: input.startsAt === undefined ? undefined : dateValue(input.startsAt),
      endsAt: input.endsAt === undefined ? undefined : dateValue(input.endsAt),
      isActive: input.isActive,
    };
    if (input.isActive === false) await deactivateAllocation(tx, schoolId, allocationId);
    const updated = await tx.teacherAllocation.update({
      where: { id: allocationId },
      data: updateData,
    });
    if (input.isActive === false) {
      const oldClass = await tx.class.findFirst({
        where: { id: existing.classId, teacherId: existing.teacherId },
        select: { id: true },
      });
      if (oldClass) {
        await tx.class.update({ where: { id: oldClass.id }, data: { teacherId: null } });
      }
    }
    await writeAudit(tx, user, schoolId, 'TEACHER_ALLOCATION_UPDATED', 'TeacherAllocation', allocationId, {
      old: assignmentSnapshot(existing),
      new: assignmentSnapshot(updated),
    });
    return updated;
  });
};

export const submitAllocationRequest = async (
  user: TokenPayload,
  input: CreateAllocationRequestInput,
) => {
  if (user.role !== 'ORGANISER' || !user.schoolId) {
    throw forbidden('Only a school administrator can request allocation changes');
  }
  const schoolId = user.schoolId;
  return withTenant(schoolId, async (tx) => {
    await requireTeacherAndClass(tx, schoolId, input.teacherId, input.classId);
    if (input.targetAllocationId) {
      const target = await tx.teacherAllocation.findFirst({
        where: { id: input.targetAllocationId, schoolId, isActive: true },
        select: { id: true },
      });
      if (!target) throw badRequest('Choose an active allocation in your school');
    }
    const allocationRequest = await tx.teacherAllocationRequest.create({
      data: {
        schoolId,
        requesterId: user.userId,
        teacherId: input.teacherId,
        classId: input.classId,
        subject: input.subject,
        section: input.section,
        weeklyHours: input.weeklyHours,
        startsAt: dateValue(input.startsAt),
        endsAt: dateValue(input.endsAt),
        type: input.type,
        targetAllocationId: input.targetAllocationId,
        note: input.note,
      },
    });
    await writeAudit(tx, user, schoolId, 'TEACHER_ALLOCATION_REQUESTED', 'TeacherAllocationRequest', allocationRequest.id, {
      type: input.type,
      targetAllocationId: input.targetAllocationId ?? null,
      requested: {
        teacherId: input.teacherId,
        classId: input.classId,
        subject: input.subject,
        section: input.section,
        weeklyHours: input.weeklyHours,
      },
    });
    return allocationRequest;
  });
};

export const decideAllocationRequest = async (
  user: TokenPayload,
  requestId: string,
  input: DecideAllocationRequestInput,
) => {
  if (user.role !== 'ADMIN') throw forbidden('Only a platform administrator can decide allocation requests');
  return asSuperAdmin(async (tx) => {
    const request = await tx.teacherAllocationRequest.findUnique({ where: { id: requestId } });
    if (!request) throw notFound('Teacher allocation request not found');
    if (request.status !== 'PENDING') throw conflict('This request has already been decided');
    const decidedAt = new Date();
    const claimed = await tx.teacherAllocationRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: {
        status: input.decision,
        reviewerId: user.userId,
        decidedAt,
        decisionNote: input.decisionNote,
      },
    });
    if (claimed.count !== 1) throw conflict('This request has already been decided');

    let allocationId: string | null = null;
    let replacedSnapshot: ReturnType<typeof assignmentSnapshot> | null = null;
    if (input.decision === 'APPROVED') {
      await requireTeacherAndClass(tx, request.schoolId, request.teacherId, request.classId);
      if (request.targetAllocationId) {
        const target = await tx.teacherAllocation.findFirst({
          where: { id: request.targetAllocationId, schoolId: request.schoolId, isActive: true },
        });
        if (!target) throw conflict('The allocation selected for replacement is no longer active');
        replacedSnapshot = assignmentSnapshot(target);
        const deactivated = await deactivateAllocation(tx, request.schoolId, target.id);
        await writeAudit(
          tx,
          user,
          request.schoolId,
          'TEACHER_ALLOCATION_REASSIGNED',
          'TeacherAllocation',
          target.id,
          { old: replacedSnapshot, new: assignmentSnapshot(deactivated), requestId },
        );
        const oldClass = await tx.class.findFirst({
          where: { id: target.classId, teacherId: target.teacherId },
          select: { id: true },
        });
        if (oldClass) {
          await tx.class.update({
            where: { id: oldClass.id },
            data: { teacherId: target.classId === request.classId ? request.teacherId : null },
          });
        }
      }
      const created = await createAllocation(tx, user, request.schoolId, {
        teacherId: request.teacherId,
        classId: request.classId,
        subject: request.subject,
        section: request.section,
        weeklyHours: request.weeklyHours,
        startsAt: asDateOnly(request.startsAt),
        endsAt: asDateOnly(request.endsAt),
      });
      allocationId = created.id;
      if (replacedSnapshot) {
        await writeAudit(
          tx,
          user,
          request.schoolId,
          'TEACHER_ALLOCATION_REPLACEMENT_CREATED',
          'TeacherAllocation',
          created.id,
          { old: replacedSnapshot, new: assignmentSnapshot(created), requestId },
        );
      }
    }

    const decided = await tx.teacherAllocationRequest.update({
      where: { id: requestId },
      data: { allocationId },
    });
    await writeAudit(tx, user, request.schoolId, `TEACHER_ALLOCATION_REQUEST_${input.decision}`, 'TeacherAllocationRequest', requestId, {
      allocationId,
      decisionNote: input.decisionNote ?? null,
      replaced: replacedSnapshot,
    });
    return decided;
  });
};

const assertTimetableSlotAvailable = async (
  tx: TenantClient,
  schoolId: string,
  allocationId: string,
  weekday: number,
  startMinute: number,
  endMinute: number,
) => {
  const allocation = await tx.teacherAllocation.findFirst({
    where: { id: allocationId, schoolId, isActive: true },
    select: { id: true, teacherId: true, classId: true, section: true, startsAt: true, endsAt: true },
  });
  if (!allocation) throw notFound('Active teacher allocation not found');

  const lockKeys = [
    `teacher-timetable:${schoolId}:${allocation.teacherId}:${weekday}`,
    `class-timetable:${schoolId}:${allocation.classId}:${allocation.section}:${weekday}`,
  ].sort();
  for (const lockKey of lockKeys) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  }

  const [availability, slots] = await Promise.all([
    tx.teacherAvailability.findMany({
      where: { schoolId, teacherId: allocation.teacherId, weekday },
      select: { startMinute: true, endMinute: true },
    }),
    tx.teacherTimetableSlot.findMany({
      where: { schoolId, weekday, allocationId: { not: allocationId } },
      include: {
        allocation: {
          select: {
            id: true,
            teacherId: true,
            classId: true,
            section: true,
            startsAt: true,
            endsAt: true,
            isActive: true,
          },
        },
      },
    }),
  ]);

  if (availability.length > 0 && !availability.some(
    (window) => window.startMinute <= startMinute && window.endMinute >= endMinute,
  )) {
    throw conflict('The timetable slot falls outside the teacher’s configured availability');
  }

  const overlap = slots.find((slot) => {
    const other = slot.allocation;
    const timeOverlaps = startMinute < slot.endMinute && slot.startMinute < endMinute;
    const dateOverlaps = rangesOverlap(allocation.startsAt, allocation.endsAt, other.startsAt, other.endsAt);
    return other.isActive && timeOverlaps && dateOverlaps &&
      (other.teacherId === allocation.teacherId ||
        (other.classId === allocation.classId && other.section === allocation.section));
  });
  if (overlap) {
    throw conflict(
      overlap.allocation.teacherId === allocation.teacherId
        ? 'This teacher already has a timetable assignment during that time'
        : 'This class section already has a timetable assignment during that time',
    );
  }
  return allocation;
};

export const addTimetableSlot = async (
  user: TokenPayload,
  schoolId: string,
  allocationId: string,
  input: CreateTimetableSlotInput,
) => {
  if (user.role !== 'ADMIN') throw forbidden('Only a platform administrator may edit timetables');
  return scoped(user, schoolId, async (tx) => {
    const allocation = await assertTimetableSlotAvailable(
      tx,
      schoolId,
      allocationId,
      input.weekday,
      input.startMinute,
      input.endMinute,
    );
    const slot = await tx.teacherTimetableSlot.create({
      data: {
        schoolId,
        allocationId,
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
      },
    });
    await writeAudit(tx, user, schoolId, 'TEACHER_TIMETABLE_SLOT_CREATED', 'TeacherTimetableSlot', slot.id, {
      allocationId,
      teacherId: allocation.teacherId,
      classId: allocation.classId,
      ...input,
    });
    return slot;
  });
};

export const removeTimetableSlot = async (
  user: TokenPayload,
  schoolId: string,
  allocationId: string,
  slotId: string,
) => {
  if (user.role !== 'ADMIN') throw forbidden('Only a platform administrator may edit timetables');
  return scoped(user, schoolId, async (tx) => {
    const slot = await tx.teacherTimetableSlot.findFirst({
      where: { id: slotId, allocationId, schoolId },
    });
    if (!slot) throw notFound('Timetable slot not found');
    await tx.teacherTimetableSlot.delete({ where: { id: slotId } });
    await writeAudit(tx, user, schoolId, 'TEACHER_TIMETABLE_SLOT_REMOVED', 'TeacherTimetableSlot', slotId, {
      allocationId,
      removed: slot,
    });
    return { id: slotId };
  });
};

export const setTeacherAvailability = async (
  user: TokenPayload,
  schoolId: string,
  teacherId: string,
  input: AvailabilityInput,
) =>
  scoped(user, schoolId, async (tx) => {
    if (user.role !== 'ADMIN' && !(user.role === 'TEACHER' && teacherId === user.userId)) {
      throw forbidden('Teachers may only manage their own availability');
    }
    const teacher = await tx.user.findFirst({
      where: { id: teacherId, schoolId, role: 'TEACHER', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!teacher) throw notFound('Teacher not found');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const lockKey = `teacher-timetable:${schoolId}:${teacherId}:${weekday}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }
    const previous = await tx.teacherAvailability.findMany({ where: { schoolId, teacherId } });
    const currentSlots = await tx.teacherTimetableSlot.findMany({
      where: { schoolId, allocation: { teacherId, ...activeOnDateWhere(today) } },
      select: { weekday: true, startMinute: true, endMinute: true },
    });
    for (const slot of currentSlots) {
      const windows = input.availability.filter((window) => window.weekday === slot.weekday);
      if (input.availability.length > 0 && !windows.some(
        (window) => window.startMinute <= slot.startMinute && window.endMinute >= slot.endMinute,
      )) {
        throw conflict('Availability cannot exclude an existing timetable slot');
      }
    }

    await tx.teacherAvailability.deleteMany({ where: { schoolId, teacherId } });
    const updated = input.availability.length
      ? await tx.teacherAvailability.createManyAndReturn({
          data: input.availability.map((window) => ({ schoolId, teacherId, ...window })),
        })
      : [];
    await writeAudit(tx, user, schoolId, 'TEACHER_AVAILABILITY_UPDATED', 'TeacherAvailability', teacherId, {
      old: previous,
      new: updated,
    });
    return updated;
  });

export const listAllocationHistory = async (
  user: TokenPayload,
  schoolId: string,
  allocationId: string,
) =>
  scoped(user, schoolId, async (tx) => {
    const allocation = await tx.teacherAllocation.findFirst({
      where: { id: allocationId, schoolId },
      select: { id: true },
    });
    if (!allocation) throw notFound('Teacher allocation not found');
    return tx.auditLog.findMany({
      where: {
        schoolId,
        entity: 'TeacherAllocation',
        entityId: allocationId,
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });
