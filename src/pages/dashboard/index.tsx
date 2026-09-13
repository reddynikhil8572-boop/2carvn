import { useAuthUser } from '@/stores/auth';
import { SuperAdminPanel, SchoolAdminPanel, TeacherPanel, StudentPanel } from '@/pages/dashboard/panels';

/**
 * Role-switching dashboard root. Each role renders its own composition from
 * the shared real endpoints — no fabricated aggregate API.
 */
export function DashboardPage() {
  const user = useAuthUser();

  if (!user) return null;

  switch (user.role) {
    case 'SUPER_ADMIN':
      return <SuperAdminPanel />;
    case 'SCHOOL_ADMIN':
      return <SchoolAdminPanel />;
    case 'TEACHER':
      return <TeacherPanel />;
    case 'STUDENT':
      return <StudentPanel />;
    default:
      return null;
  }
}