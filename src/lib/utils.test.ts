import { describe, expect, it } from 'vitest';

import { isSchoolAdmin, isStaff, isStudent, isSuperAdmin, isTeacher, roleLabel } from '@/lib/utils';

describe('role guard helpers', () => {
  it('identifies SUPER_ADMIN', () => {
    expect(isSuperAdmin('SUPER_ADMIN')).toBe(true);
    expect(isSuperAdmin('TEACHER')).toBe(false);
  });

  it('identifies SCHOOL_ADMIN only by its exact role', () => {
    expect(isSchoolAdmin('SCHOOL_ADMIN')).toBe(true);
    // Staff is a broader concept — a school admin is staff, but the guard
    // itself must not over-match other roles.
    expect(isSchoolAdmin('TEACHER')).toBe(false);
  });

  it('distinguishes staff (admin + teacher) from students', () => {
    expect(isStaff('SCHOOL_ADMIN')).toBe(true);
    expect(isStaff('TEACHER')).toBe(true);
    expect(isStaff('STUDENT')).toBe(false);
  });

  it('identifies teacher and student roles', () => {
    expect(isTeacher('TEACHER')).toBe(true);
    expect(isStudent('STUDENT')).toBe(true);
  });
});

describe('roleLabel', () => {
  it('maps every UserRole to a human label', () => {
    expect(roleLabel('SUPER_ADMIN')).toBe('Super Admin');
    expect(roleLabel('SCHOOL_ADMIN')).toBe('School Admin');
    expect(roleLabel('TEACHER')).toBe('Teacher');
    expect(roleLabel('STUDENT')).toBe('Student');
    expect(roleLabel('PARENT')).toBe('Parent');
  });
});