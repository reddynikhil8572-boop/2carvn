import { describe, expect, it } from 'vitest';

import { isAdmin, isOrganiser, isStaff, isStudent, isTeacher, roleLabel } from '@/lib/utils';

describe('role guard helpers', () => {
  it('identifies ADMIN', () => {
    expect(isAdmin('ADMIN')).toBe(true);
    expect(isAdmin('TEACHER')).toBe(false);
  });

  it('identifies ORGANISER only by its exact role', () => {
    expect(isOrganiser('ORGANISER')).toBe(true);
    // Staff is a broader concept — an organiser is staff, but the guard
    // itself must not over-match other roles.
    expect(isOrganiser('TEACHER')).toBe(false);
  });

  it('distinguishes staff (organiser + teacher) from students', () => {
    expect(isStaff('ORGANISER')).toBe(true);
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
    expect(roleLabel('ADMIN')).toBe('Admin');
    expect(roleLabel('ORGANISER')).toBe('Organiser');
    expect(roleLabel('TEACHER')).toBe('Teacher');
    expect(roleLabel('STUDENT')).toBe('Student');
    expect(roleLabel('COORDINATOR')).toBe('Coordinator');
  });
});