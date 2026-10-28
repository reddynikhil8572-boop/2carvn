import {
  LayoutDashboard,
  GraduationCap,
  Users,
  BookOpen,
  FileCheck2,
  Award,
  Settings,
  Building2,
  ClipboardList,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

import type { UserRole } from '@/types/api';
import { isAdmin, isOrganiser, isStaff, isStudent } from '@/lib/utils';

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

  if (isAdmin(role)) {
    groups.push({
      label: 'Platform',
      items: [
        { title: 'Schools', href: '/admin/schools', icon: Building2 },
        { title: 'Divisions', href: '/admin/divisions', icon: Building2 },
        { title: 'Public enquiries', href: '/admin/enquiries', icon: MessageSquareText },
        { title: 'Teacher allocation', href: '/teacher-allocations', icon: ClipboardList },
      ],
    });
  }

  if (isOrganiser(role)) {
    groups.push({
      label: 'Management',
      items: [
        { title: 'Classes', href: '/classes', icon: GraduationCap },
        { title: 'Students', href: '/students', icon: Users },
        { title: 'Users', href: '/users', icon: Users },
        { title: 'Teacher allocation', href: '/teacher-allocations', icon: ClipboardList },
      ],
    });
  }

  if (isStaff(role)) {
    groups.push({
      label: 'Teaching',
      items: [
        { title: 'Courses', href: '/courses', icon: BookOpen },
        ...(role === 'TEACHER'
          ? [{ title: 'My schedule', href: '/teacher-allocations', icon: ClipboardList }]
          : []),
      ],
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
  ADMIN: '/admin/schools',
  ORGANISER: '/dashboard',
  TEACHER: '/dashboard',
  STUDENT: '/courses',
  COORDINATOR: '/dashboard',
};

export function defaultRouteFor(role: UserRole): string {
  return rolePrimaryDestination[role];
}