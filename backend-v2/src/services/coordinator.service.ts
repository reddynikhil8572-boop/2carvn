import { asSuperAdmin } from '../db/tenantContext';
import type { TokenPayload } from '../utils/jwt';

const forbidden = () => Object.assign(new Error('Coordinator access is required'), { statusCode: 403 });

export const getCoordinatorWorkspace = async (user: TokenPayload) => {
  if (user.role !== 'COORDINATOR') throw forbidden();

  // This narrowly scoped platform query is keyed only by the authenticated
  // coordinator ID; all school and class IDs are derived from active grants.
  return asSuperAdmin(async (tx) => {
    const grants = await tx.coordinatorDivision.findMany({
      where: {
        coordinatorId: user.userId,
        revokedAt: null,
        coordinator: { status: 'ACTIVE', role: 'COORDINATOR' },
      },
      select: {
        division: {
          select: {
            id: true,
            code: true,
            name: true,
            region: true,
            schools: {
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
                schoolCode: true,
                city: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    const divisions = grants.map((grant) => grant.division);
    const schoolIds = [...new Set(divisions.flatMap((division) => division.schools.map((school) => school.id)))];
    if (schoolIds.length === 0) return { divisions: [] };

    const students = await tx.user.groupBy({
      by: ['schoolId', 'status'],
      where: { schoolId: { in: schoolIds }, role: 'STUDENT' },
      _count: { _all: true },
    });
    const classes = await tx.class.findMany({
      where: { schoolId: { in: schoolIds } },
      orderBy: [{ schoolId: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        schoolId: true,
        name: true,
        academicYear: true,
        _count: { select: { enrollments: true } },
      },
    });

    return {
      divisions: divisions.map((division) => ({
        ...division,
        schools: division.schools.map((school) => ({
          ...school,
          studentCounts: students
            .filter((entry) => entry.schoolId === school.id)
            .reduce(
              (counts, entry) => ({
                ...counts,
                total: counts.total + entry._count._all,
                active: counts.active + (entry.status === 'ACTIVE' ? entry._count._all : 0),
                inactive: counts.inactive + (entry.status === 'INACTIVE' ? entry._count._all : 0),
                suspended: counts.suspended + (entry.status === 'SUSPENDED' ? entry._count._all : 0),
              }),
              { total: 0, active: 0, inactive: 0, suspended: 0 },
            ),
          classes: classes
            .filter((klass) => klass.schoolId === school.id)
            .map((klass) => ({
              id: klass.id,
              name: klass.name,
              academicYear: klass.academicYear,
              studentCount: klass._count.enrollments,
            })),
        })),
      })),
    };
  });
};
