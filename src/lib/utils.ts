import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { UserRole } from '@/types/api';

/** Merge Tailwind classes safely (deduplicates conflicting utilities). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Guard helpers — used in route guards and conditional UI. */
export const isAdmin = (role: UserRole) => role === 'ADMIN';
export const isOrganiser = (role: UserRole) => role === 'ORGANISER';
export const isTeacher = (role: UserRole) => role === 'TEACHER';
export const isStudent = (role: UserRole) => role === 'STUDENT';
export const isStaff = (role: UserRole) =>
  role === 'ORGANISER' || role === 'TEACHER';

/** Short plural label for a role. */
export const roleLabel = (role: UserRole): string => {
  switch (role) {
    case 'ADMIN':
      return 'Admin';
    case 'ORGANISER':
      return 'Organiser';
    case 'TEACHER':
      return 'Teacher';
    case 'STUDENT':
      return 'Student';
    case 'COORDINATOR':
      return 'Coordinator';
  }
};
