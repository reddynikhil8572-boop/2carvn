import { lazy, Suspense, useEffect, type PropsWithChildren } from 'react';
import { createBrowserRouter, useNavigate } from 'react-router-dom';

import { useSession } from '@/hooks/useAuth';
import { defaultRouteFor } from '@/components/layout/nav';
import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth, RequireRole, CenteredLoader } from '@/components/auth/route-guards';

// Pages are lazy-loaded so each route ships in its own chunk; the shell, auth
// guards and session bootstrap stay on the critical boot path.
const LoginPage = lazy(() => import('@/pages/auth/login').then((m) => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/forgot-password').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/auth/reset-password').then((m) => ({ default: m.ResetPasswordPage })));
const TwoFactorPage = lazy(() => import('@/pages/auth/two-factor').then((m) => ({ default: m.TwoFactorPage })));
const NotFoundPage = lazy(() => import('@/pages/shell/not-found').then((m) => ({ default: m.NotFoundPage })));
const ForbiddenPage = lazy(() => import('@/pages/shell/forbidden').then((m) => ({ default: m.ForbiddenPage })));
const DashboardPage = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const CoursesPage = lazy(() => import('@/pages/courses').then((m) => ({ default: m.CoursesPage })));
const CourseDetailPage = lazy(() => import('@/pages/courses/course-detail').then((m) => ({ default: m.CourseDetailPage })));
const CourseLearnPage = lazy(() => import('@/pages/courses/course-learn').then((m) => ({ default: m.CourseLearnPage })));
const CourseEditPage = lazy(() => import('@/pages/courses/course-edit').then((m) => ({ default: m.CourseEditPage })));
const ClassesPage = lazy(() => import('@/pages/classes').then((m) => ({ default: m.ClassesPage })));
const ClassDetailPage = lazy(() => import('@/pages/classes/class-detail').then((m) => ({ default: m.ClassDetailPage })));
const UsersPage = lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPage })));
const StudentsPage = lazy(() => import('@/pages/students').then((m) => ({ default: m.StudentsPage })));
const UserDetailPage = lazy(() => import('@/pages/users/user-detail').then((m) => ({ default: m.UserDetailPage })));
const AssignmentsPage = lazy(() => import('@/pages/assignments').then((m) => ({ default: m.AssignmentsPage })));
const AssignmentDetailPage = lazy(() => import('@/pages/assignments/assignment-detail').then((m) => ({ default: m.AssignmentDetailPage })));
const QuizDetailPage = lazy(() => import('@/pages/quizzes/quiz-detail').then((m) => ({ default: m.QuizDetailPage })));
const CertificatesPage = lazy(() => import('@/pages/certificates').then((m) => ({ default: m.CertificatesPage })));
const CertificateVerifyPage = lazy(() => import('@/pages/certificates/certificate-verify').then((m) => ({ default: m.CertificateVerifyPage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })));
const SecuritySettingsPage = lazy(() => import('@/pages/settings/security').then((m) => ({ default: m.SecuritySettingsPage })));
const SuperAdminSchoolsPage = lazy(() => import('@/pages/super-admin/schools').then((m) => ({ default: m.SuperAdminSchoolsPage })));

/** Suspense boundary used by every lazy route so the chunk fetch shows a loader. */
function RouteFallback({ children }: PropsWithChildren) {
  return <Suspense fallback={<CenteredLoader />}>{children}</Suspense>;
}

function HomeRedirect() {
  const { loading, authenticated, user } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!authenticated || !user) {
      navigate('/login', { replace: true });
    } else {
      navigate(defaultRouteFor(user.role), { replace: true });
    }
  }, [loading, authenticated, user, navigate]);

  return <CenteredLoader />;
}

export const router = createBrowserRouter([
  // ── Public ───────────────────────────────────────────────────────────────
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <RouteFallback><LoginPage /></RouteFallback> },
  { path: '/forgot-password', element: <RouteFallback><ForgotPasswordPage /></RouteFallback> },
  { path: '/reset-password', element: <RouteFallback><ResetPasswordPage /></RouteFallback> },
  { path: '/2fa', element: <RouteFallback><TwoFactorPage /></RouteFallback> },

  // ── Authenticated shell ──────────────────────────────────────────────────
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/dashboard', element: <RouteFallback><DashboardPage /></RouteFallback> },

      // Courses (staff author; students learn; teachers author + teach)
      { path: '/courses', element: <RouteFallback><CoursesPage /></RouteFallback> },
      { path: '/courses/:id', element: <RouteFallback><CourseDetailPage /></RouteFallback> },
      { path: '/courses/:id/learn', element: <RouteFallback><CourseLearnPage /></RouteFallback> },
      {
        path: '/courses/:id/edit',
        element: (
          <RequireRole roles={['SCHOOL_ADMIN', 'TEACHER']}>
            <RouteFallback><CourseEditPage /></RouteFallback>
          </RequireRole>
        ),
      },

      // Classes (school-admin writes; teachers read)
      { path: '/classes', element: <RouteFallback><ClassesPage /></RouteFallback> },
      { path: '/classes/:id', element: <RouteFallback><ClassDetailPage /></RouteFallback> },

      // Users (school-admin roster)
      { path: '/users', element: <RouteFallback><UsersPage /></RouteFallback> },
      { path: '/students', element: <RequireRole roles={['SCHOOL_ADMIN']}><RouteFallback><StudentsPage /></RouteFallback></RequireRole> },
      { path: '/users/:id', element: <RouteFallback><UserDetailPage /></RouteFallback> },
      { path: '/school-admin/users', element: <RouteFallback><UsersPage /></RouteFallback> },

      // Assignments & quizzes (by lesson item)
      { path: '/assignments', element: <RouteFallback><AssignmentsPage /></RouteFallback> },
      { path: '/assignments/:id', element: <RouteFallback><AssignmentDetailPage /></RouteFallback> },
      { path: '/quizzes/:id', element: <RouteFallback><QuizDetailPage /></RouteFallback> },

      // Certificates
      { path: '/certificates', element: <RouteFallback><CertificatesPage /></RouteFallback> },
      { path: '/certificates/verify/:serial', element: <RouteFallback><CertificateVerifyPage /></RouteFallback> },

      // Settings
      { path: '/settings', element: <RouteFallback><SettingsPage /></RouteFallback> },
      { path: '/settings/security', element: <RouteFallback><SecuritySettingsPage /></RouteFallback> },

      // Super-admin
      {
        path: '/super-admin/schools',
        element: (
          <RequireRole roles={['SUPER_ADMIN']}>
            <RouteFallback><SuperAdminSchoolsPage /></RouteFallback>
          </RequireRole>
        ),
      },
    ],
  },

  // ── Terminal ─────────────────────────────────────────────────────────────
  { path: '/forbidden', element: <RouteFallback><ForbiddenPage /></RouteFallback> },
  { path: '*', element: <RouteFallback><NotFoundPage /></RouteFallback> },
]);