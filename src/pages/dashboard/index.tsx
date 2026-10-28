import { useAuthUser } from '@/stores/auth';
import { AdminPanel, OrganiserPanel, CoordinatorPanel, TeacherPanel, StudentPanel } from '@/pages/dashboard/panels';

/**
 * Role-switching dashboard root. Each role renders its own composition from
 * the shared real endpoints — no fabricated aggregate API.
 */
export function DashboardPage() {
  const user = useAuthUser();

  if (!user) return null;

  switch (user.role) {
    case 'ADMIN':
      return <AdminPanel />;
    case 'ORGANISER':
      return <OrganiserPanel />;
    case 'TEACHER':
      return <TeacherPanel />;
    case 'STUDENT':
      return <StudentPanel />;
    case 'COORDINATOR':
      return <CoordinatorPanel />;
    default:
      return null;
  }
}