import {
  LayoutDashboard,
  GraduationCap,
  Users,
  BookOpen,
  FileCheck2,
  Award,
  Settings,
  Building2,
  type LucideIcon,
} from 'lucide-react';

import type { UserRole } from '@/types/api';
import { isSchoolAdmin, isStaff, isStudent, isSuperAdmin } from '@/lib/utils';

/**
 * Role-based navigation. `NavGroup[]` is the single source of truth for the
 * sidebar; guards and the breadcrumb both derive from it.
 */

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  highlight?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export function navFor(role: UserRole): NavGroup[] {
  const groups: NavGroup[] = [];

  groups.push({
    label: 'Overview',
    items: [{ title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, highlight: true }],
  });

  if (isSuperAdmin(role)) {
    groups.push({
      label: 'Platform',
      items: [{ title: 'Schools', href: '/super-admin/schools', icon: Building2 }],
    });
  }

  if (isSchoolAdmin(role)) {
    groups.push({
      label: 'Management',
      items: [
        { title: 'Classes', href: '/classes', icon: GraduationCap },
        { title: 'Users', href: '/users', icon: Users },
      ],
    });
  }

  if (isStaff(role)) {
    groups.push({
      label: 'Teaching',
      items: [{ title: 'Courses', href: '/courses', icon: BookOpen }],
    });
  }

  if (isStudent(role)) {
    groups.push({
      label: 'Learning',
      items: [
        { title: 'My Courses', href: '/courses', icon: BookOpen },
        { title: 'Assignments', href: '/assignments', icon: FileCheck2 },
        { title: 'Certificates', href: '/certificates', icon: Award },
      ],
    });
  }

  groups.push({
    label: 'Account',
    items: [{ title: 'Settings', href: '/settings', icon: Settings }],
  });

  return groups;
}

const rolePrimaryDestination: Record<UserRole, string> = {
  SUPER_ADMIN: '/super-admin/schools',
  SCHOOL_ADMIN: '/dashboard',
  TEACHER: '/dashboard',
  STUDENT: '/courses',
  PARENT: '/dashboard',
};

export function defaultRouteFor(role: UserRole): string {
  return rolePrimaryDestination[role];
}