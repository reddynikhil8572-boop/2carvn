import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';
import { prisma } from '../src/db/prisma';

const SCHOOL = 'ALLOC-A';
const PASSWORD = 'Passw0rd!x';
const ownerEmail = 'owner@alloc.test';
const adminEmail = 'admin@alloc.test';
const firstTeacherEmail = 'teacher-one@alloc.test';
const replacementTeacherEmail = 'teacher-two@alloc.test';
const studentEmail = 'student@alloc.test';

const ids = {
  school: '',
  firstTeacher: '',
  replacementTeacher: '',
  assignedClass: '',
  unassignedClass: '',
  student: '',
  allocation: '',
  request: '',
};

const signIn = async (email: string, schoolCode?: string) => {
  const agent = request.agent(app);
  const response = await agent.post('/api/v1/auth/login').send({
    ...(schoolCode ? { schoolCode } : {}),
    email,
    password: PASSWORD,
  });
  expect(response.status, response.text).toBe(200);
  return agent;
};

let owner: ReturnType<typeof request.agent>;
let schoolAdmin: ReturnType<typeof request.agent>;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await asSuperAdmin(async (tx) => {
    await tx.user.create({
      data: { email: ownerEmail, passwordHash, name: 'Allocation Owner', role: 'ADMIN' },
    });
    const school = await tx.school.create({
      data: { schoolCode: SCHOOL, name: 'Allocation Academy' },
    });
    ids.school = school.id;
  });

  owner = await signIn(ownerEmail);
  await withTenant(ids.school, async (tx) => {
    await tx.user.create({
      data: { schoolId: ids.school, email: adminEmail, passwordHash, name: 'School Principal', role: 'ORGANISER' },
    });
    const firstTeacher = await tx.user.create({
      data: { schoolId: ids.school, email: firstTeacherEmail, passwordHash, name: 'Avery Teacher', role: 'TEACHER' },
    });
    const replacementTeacher = await tx.user.create({
      data: { schoolId: ids.school, email: replacementTeacherEmail, passwordHash, name: 'Blair Teacher', role: 'TEACHER' },
    });
    const student = await tx.user.create({
      data: { schoolId: ids.school, email: studentEmail, passwordHash, name: 'Assigned Student', role: 'STUDENT' },
    });
    const assignedClass = await tx.class.create({
      data: { schoolId: ids.school, name: 'Class 1A', academicYear: '2026' },
    });
    const unassignedClass = await tx.class.create({
      data: { schoolId: ids.school, name: 'Class 2A', academicYear: '2026' },
    });
    await tx.enrollment.create({
      data: { schoolId: ids.school, classId: assignedClass.id, studentId: student.id },
    });
    ids.firstTeacher = firstTeacher.id;
    ids.replacementTeacher = replacementTeacher.id;
    ids.assignedClass = assignedClass.id;
    ids.unassignedClass = unassignedClass.id;
    ids.student = student.id;
  });
  schoolAdmin = await signIn(adminEmail, SCHOOL);
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    await tx.school.deleteMany({ where: { schoolCode: SCHOOL } });
    await tx.user.deleteMany({ where: { email: ownerEmail } });
  });
  await prisma.$disconnect();
});

describe('teacher allocation', () => {
  it('lets school admins request changes but denies direct assignment writes', async () => {
    const directWrite = await schoolAdmin
      .post(`/api/v1/super-admin/teacher-allocations?schoolId=${ids.school}`)
      .send({
        teacherId: ids.firstTeacher,
        classId: ids.assignedClass,
        subject: 'Mathematics',
        section: 'A',
        weeklyHours: 5,
      });
    expect(directWrite.status).toBe(403);

    const created = await schoolAdmin.post('/api/v1/school-admin/teacher-allocation-requests').send({
      type: 'ASSIGN',
      teacherId: ids.firstTeacher,
      classId: ids.assignedClass,
      subject: 'Mathematics',
      section: 'A',
      weeklyHours: 5,
    });
    expect(created.status, created.text).toBe(201);
    ids.request = created.body.data.id;
  });

  it('approves a requested reassignment atomically and updates teacher class access', async () => {
    const approval = await owner
      .post(`/api/v1/super-admin/teacher-allocation-requests/${ids.request}/decision`)
      .send({ decision: 'APPROVED' });
    expect(approval.status, approval.text).toBe(200);
    ids.allocation = approval.body.data.allocationId;

    const firstTeacher = await signIn(firstTeacherEmail, SCHOOL);
    const classes = await firstTeacher.get('/api/v1/classes');
    expect(classes.status).toBe(200);
    expect(classes.body.data.map((item: { id: string }) => item.id)).toEqual([ids.assignedClass]);
    expect((await firstTeacher.get(`/api/v1/classes/${ids.assignedClass}/enrollments`)).body.data)
      .toHaveLength(1);
    expect((await firstTeacher.get(`/api/v1/classes/${ids.unassignedClass}/enrollments`)).status).toBe(404);

    const schoolView = await schoolAdmin.get('/api/v1/school-admin/teacher-allocations');
    expect(schoolView.status).toBe(200);
    expect(schoolView.body.data.allocations).toHaveLength(1);

    const replacementRequest = await schoolAdmin
      .post('/api/v1/school-admin/teacher-allocation-requests')
      .send({
        type: 'REPLACE',
        targetAllocationId: ids.allocation,
        teacherId: ids.replacementTeacher,
        classId: ids.assignedClass,
        subject: 'Mathematics',
        section: 'A',
        weeklyHours: 5,
      });
    expect(replacementRequest.status, replacementRequest.text).toBe(201);

    const replacementApproval = await owner
      .post(`/api/v1/super-admin/teacher-allocation-requests/${replacementRequest.body.data.id}/decision`)
      .send({ decision: 'APPROVED' });
    expect(replacementApproval.status, replacementApproval.text).toBe(200);
    ids.allocation = replacementApproval.body.data.allocationId;

    const oldTeacher = await firstTeacher.get('/api/v1/classes');
    expect(oldTeacher.body.data).toHaveLength(0);
    const newTeacher = await signIn(replacementTeacherEmail, SCHOOL);
    expect((await newTeacher.get('/api/v1/classes')).body.data.map((item: { id: string }) => item.id))
      .toEqual([ids.assignedClass]);

    const history = await owner.get(
      `/api/v1/super-admin/teacher-allocations/${ids.allocation}/history?schoolId=${ids.school}`,
    );
    expect(history.status, history.text).toBe(200);
    expect(history.body.data.some((item: { action: string }) => item.action === 'TEACHER_ALLOCATION_REASSIGNED'))
      .toBe(true);
  });

  it('enforces availability and prevents overlapping teacher timetable slots', async () => {
    const availability = await owner.put(
      `/api/v1/super-admin/teacher-allocations/teachers/${ids.replacementTeacher}/availability?schoolId=${ids.school}`,
    ).send({
      availability: [{ weekday: 0, startMinute: 540, endMinute: 720 }],
    });
    expect(availability.status, availability.text).toBe(200);

    const firstSlot = await owner
      .post(`/api/v1/super-admin/teacher-allocations/${ids.allocation}/timetable?schoolId=${ids.school}`)
      .send({ weekday: 0, startMinute: 540, endMinute: 600 });
    expect(firstSlot.status, firstSlot.text).toBe(201);

    const secondAllocation = await owner
      .post(`/api/v1/super-admin/teacher-allocations?schoolId=${ids.school}`)
      .send({
        teacherId: ids.replacementTeacher,
        classId: ids.unassignedClass,
        subject: 'Science',
        section: 'B',
        weeklyHours: 3,
      });
    expect(secondAllocation.status, secondAllocation.text).toBe(201);

    const overlap = await owner
      .post(`/api/v1/super-admin/teacher-allocations/${secondAllocation.body.data.id}/timetable?schoolId=${ids.school}`)
      .send({ weekday: 0, startMinute: 570, endMinute: 630 });
    expect(overlap.status).toBe(409);

    const unavailable = await owner
      .post(`/api/v1/super-admin/teacher-allocations/${secondAllocation.body.data.id}/timetable?schoolId=${ids.school}`)
      .send({ weekday: 0, startMinute: 750, endMinute: 800 });
    expect(unavailable.status).toBe(409);
  });
});
