import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ClipboardCheck,
  Clock,
  Database,
  GraduationCap,
  Layers,
  Mail,
  Menu,
  School,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { toast } from 'sonner';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { listPublicCourses, submitPublicEnquiry, type PublicEnquiryInput } from '@/api/public';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const BRAND = '2CaRvN';

const publicLinks = [
  { title: 'About', href: '/about' },
  { title: 'Courses', href: '/catalog' },
  { title: 'Programmes', href: '/programmes' },
  { title: 'Contact', href: '/contact' },
];

const inputClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

/** Subtle entrance used across the public pages. Keeps motion restrained. */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Pointer-driven 3D tilt. Only responds to a mouse, and stays flat when the
 * visitor prefers reduced motion.
 */
function Tilt({
  children,
  className,
  max = 8,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(pointerY, [0, 1], [max, -max]), {
    stiffness: 140,
    damping: 18,
  });
  const rotateY = useSpring(useTransform(pointerX, [0, 1], [-max, max]), {
    stiffness: 140,
    damping: 18,
  });

  return (
    <div
      className={className}
      style={{ perspective: 1200 }}
      onPointerMove={(event) => {
        if (reduceMotion || event.pointerType !== 'mouse') return;
        const rect = event.currentTarget.getBoundingClientRect();
        pointerX.set((event.clientX - rect.left) / rect.width);
        pointerY.set((event.clientY - rect.top) / rect.height);
      }}
      onPointerLeave={() => {
        pointerX.set(0.5);
        pointerY.set(0.5);
      }}
    >
      <motion.div style={{ rotateX, rotateY }}>
        <div className="h-full w-full" style={{ transformStyle: 'preserve-3d' }}>
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}
      aria-label={`${BRAND} home`}
    >
      <img
        src="/brand-wordmark.png"
        alt=""
        width={480}
        height={236}
        className="h-10 w-auto object-contain"
      />
    </Link>
  );
}

function PublicHeader() {
  const { authenticated } = useSession();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Brand />

        <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
          {publicLinks.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  'text-sm font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {item.title}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link to={authenticated ? '/dashboard' : '/login'}>
              {authenticated ? 'Dashboard' : 'Sign in'}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/contact?kind=DEMO">Request a demo</Link>
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-foreground transition-colors hover:bg-muted md:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="public-mobile-nav"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        >
          {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      {open ? (
        <div id="public-mobile-nav" className="border-t bg-background md:hidden">
          <nav
            className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6"
            aria-label="Mobile navigation"
          >
            {publicLinks.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                {item.title}
              </NavLink>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-4">
              <Button asChild variant="outline" size="sm">
                <Link to={authenticated ? '/dashboard' : '/login'}>
                  {authenticated ? 'Dashboard' : 'Sign in'}
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/contact?kind=DEMO">Request a demo</Link>
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

const previewModules = [
  { title: 'Cell theory', state: 'complete' },
  { title: 'Organelles and function', state: 'complete' },
  { title: 'Transport across membranes', state: 'current' },
  { title: 'Cell division', state: 'upcoming' },
] as const;

function HeroPreview() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="relative mx-auto w-full max-w-md lg:max-w-none"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
    >
      <Tilt max={9}>
        <div
          className="relative"
          style={{
            transform: 'rotateY(-6deg) rotateX(2deg)',
            transformStyle: 'preserve-3d',
          }}
        >
          <div className="absolute -inset-3 rounded-3xl bg-white/5" aria-hidden />
          <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl backdrop-blur">
            <div className="overflow-hidden rounded-xl bg-white text-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 ring-1 ring-slate-200">
                <img
                  src="/brand-mark.png"
                  alt=""
                  width={180}
                  height={262}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="text-xs font-semibold">Course overview</span>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              In progress
            </span>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Biology · Year 10
              </p>
              <h2 className="mt-1 text-base font-semibold tracking-tight">
                Cell structure and function
              </h2>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Course progress</span>
                <span className="font-semibold">68%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-[68%] rounded-full bg-primary" />
              </div>
            </div>

            <ul className="space-y-2">
              {previewModules.map((module) => (
                <li
                  key={module.title}
                  className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2"
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      module.state === 'complete'
                        ? 'bg-emerald-50 text-emerald-600'
                        : module.state === 'current'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-slate-100 text-slate-400',
                    )}
                  >
                    {module.state === 'complete' ? (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    ) : module.state === 'current' ? (
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      module.state === 'upcoming'
                        ? 'text-slate-500'
                        : 'font-medium text-slate-900',
                    )}
                  >
                    {module.title}
                  </span>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  Class average
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight">84%</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  Marked this week
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight">12 / 14</p>
              </div>
            </div>
              </div>
            </div>
          </div>

          <motion.div
            style={{ z: 90 }}
            animate={reduceMotion ? undefined : { y: [0, -7, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -left-5 top-20 hidden w-48 items-center gap-2.5 rounded-xl border border-white/10 bg-slate-900/95 p-3 text-white shadow-2xl backdrop-blur sm:flex"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium">Assignment marked</span>
              <span className="block text-[10px] text-slate-400">12 submissions reviewed</span>
            </span>
          </motion.div>

          <motion.div
            style={{ z: 70 }}
            animate={reduceMotion ? undefined : { y: [0, 7, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            className="absolute -right-4 bottom-16 hidden w-48 items-center gap-2.5 rounded-xl border border-white/10 bg-slate-900/95 p-3 text-white shadow-2xl backdrop-blur sm:flex"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium">Certificate issued</span>
              <span className="block text-[10px] text-slate-400">Public verification ready</span>
            </span>
          </motion.div>
        </div>
      </Tilt>
    </motion.div>
  );
}

const heroHighlights = [
  'Role-based by design',
  'Multi-tenant isolation',
  'Privacy-first defaults',
];

function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-slate-950 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 78%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-0 h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            Learning, connected
          </p>

          <h1 className="mt-6 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
            A clearer path from teaching to achievement.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            A digital learning space for schools, educators, and students to organise courses,
            learning activities, and progress in one place.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/contact?kind=DEMO">
                Request a demo <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link to="/catalog">Explore courses</Link>
            </Button>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
            {heroHighlights.map((item) => (
              <li key={item} className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        <HeroPreview />
      </div>
    </section>
  );
}

const roles = [
  {
    icon: Building2,
    title: 'School administrators',
    description: 'Oversee classes, users, and teaching allocations.',
  },
  {
    icon: Layers,
    title: 'Programme coordinators',
    description: 'Keep courses and teacher coverage aligned.',
  },
  {
    icon: BookOpen,
    title: 'Teachers',
    description: 'Plan lessons, assessments, and marking.',
  },
  {
    icon: GraduationCap,
    title: 'Students',
    description: 'Follow assigned learning and track progress.',
  },
];

function RoleStrip() {
  return (
    <section className="border-b bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Built for every role in the school community
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map((role, index) => (
            <Reveal key={role.title} delay={index * 0.05}>
              <div className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <role.icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">{role.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {role.description}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {description ? (
        <p className="mt-3 text-base leading-7 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

const features = [
  {
    icon: BookOpen,
    title: 'Courses and lessons',
    text: 'Build structured courses from lessons and resources, with video progress tracking built in.',
  },
  {
    icon: ClipboardCheck,
    title: 'Assessments',
    text: 'Create quizzes and assignments, publish them to classes, and keep marking in one place.',
  },
  {
    icon: GraduationCap,
    title: 'Progress and certificates',
    text: 'Give learners a clear view of completion, achievement, and shareable certificates.',
  },
  {
    icon: Users,
    title: 'Classes and teaching teams',
    text: 'Organise classes and allocate teachers without spreading information across tools.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles and permissions',
    text: 'Five role divisions keep access purposeful, from platform administration to the classroom.',
  },
  {
    icon: Layers,
    title: 'Privacy and isolation',
    text: 'School data stays separated at the database layer, with support for erasure requests.',
  },
];

function FeatureSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal>
        <SectionHeading
          eyebrow="Platform"
          title="Everything the school needs, without the noise."
          description="One workspace for course delivery, classroom organisation, assessment, and progress. Each role sees the tools it needs, and nothing more."
        />
      </Reveal>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => (
          <Reveal key={feature.title} delay={index * 0.04} className="h-full">
            <div className="h-full rounded-xl border bg-card p-6 transition-colors hover:border-primary/40">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/50 text-primary">
                <feature.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-semibold tracking-tight">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const steps = [
  {
    title: 'Set up the school',
    text: 'Create the school workspace, classes, and role assignments for your team.',
  },
  {
    title: 'Publish learning',
    text: 'Add courses, lessons, assessments, and the teachers who deliver them.',
  },
  {
    title: 'Track and certify',
    text: 'Follow progress, review results, and issue certificates where enabled.',
  },
];

function ProcessSection() {
  return (
    <section className="border-y bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            title="From setup to certification."
            description="A straightforward path for schools already doing the work, with fewer places to keep information in sync."
          />
        </Reveal>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.06}>
              <div>
                <p className="text-sm font-semibold text-primary">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <div className="mt-3 border-t pt-4">
                  <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const securityLayers = [
  {
    icon: School,
    title: 'School workspace',
    text: 'Courses, classes, and people',
    depth: 96,
    offset: 0,
  },
  {
    icon: Users,
    title: 'Role permissions',
    text: 'Scoped by responsibility',
    depth: 48,
    offset: 16,
  },
  {
    icon: Database,
    title: 'Isolated data',
    text: 'Row-level security',
    depth: 0,
    offset: 32,
  },
];

function SecurityVisual() {
  return (
    <Tilt max={11} className="mx-auto w-full max-w-md">
      <div
        className="relative h-[21rem]"
        style={{
          transform: 'rotateX(4deg) rotateY(-10deg)',
          transformStyle: 'preserve-3d',
        }}
      >
        {securityLayers.map((layer, index) => (
          <div
            key={layer.title}
            className="absolute left-0 top-0 w-full rounded-xl border bg-card p-5 shadow-xl"
            style={{
              transform: `translate3d(${layer.offset}px, ${layer.offset}px, ${layer.depth}px)`,
              zIndex: securityLayers.length - index,
            }}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <layer.icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold">{layer.title}</p>
                <p className="text-xs text-muted-foreground">{layer.text}</p>
              </div>
            </div>

            {index === 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {['Courses', 'Classes', 'Certificates'].map((item) => (
                  <span
                    key={item}
                    className="rounded-md border bg-muted/40 px-2 py-1.5 text-center text-[11px] text-muted-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <div
          className="absolute -right-3 bottom-4 hidden items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg sm:flex"
          style={{ transform: 'translate3d(0, 0, 150px)' }}
        >
          <ScrollText className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-[11px] font-medium">Audit log · append-only</span>
        </div>
      </div>
    </Tilt>
  );
}

const securityPoints = [
  'Row-level security with fail-closed tenant policies',
  'Role-based access across five role divisions',
  'Two-factor authentication with recovery codes',
  'Append-only audit logs and erasure support',
];

function SecuritySection() {
  return (
    <section
      id="security"
      className="mx-auto max-w-7xl overflow-hidden px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
        <Reveal>
          <SectionHeading
            eyebrow="Trust and privacy"
            title="School data, isolated by design."
            description="Tenant isolation is enforced in PostgreSQL with row-level security, not just in application code. Access is scoped to the signed-in school, and every role has a defined set of permissions."
          />

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {securityPoints.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="outline">
              <Link to="/contact">
                Ask about security <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              Detailed practices are shared during evaluation.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <SecurityVisual />
        </Reveal>
      </div>
    </section>
  );
}

const faqs = [
  {
    question: `What is ${BRAND}?`,
    answer: `${BRAND} is a digital learning space that brings courses, classes, assessments, progress, and certificates into one shared workspace for schools.`,
  },
  {
    question: 'Who is the platform built for?',
    answer:
      'School communities: administrators, programme coordinators, teachers, and students. Each role has its own set of tools, and schools control which features are enabled.',
  },
  {
    question: 'How does a school get started?',
    answer:
      'Request a demo. We will discuss your school structure, classes, roles, and the courses you want to publish, then guide the setup process.',
  },
  {
    question: "Is each school's data separated?",
    answer:
      "Yes. Tenant isolation is enforced in PostgreSQL with row-level security, so a session scoped to one school cannot read another school's rows. Application access is also role-based.",
  },
  {
    question: 'What account protections are available?',
    answer:
      'Two-factor authentication with recovery codes, AES-256-GCM encryption for authenticator secrets, rate-limited sign-in, and refresh-token rotation are built in.',
  },
  {
    question: 'Can learner data be exported or erased?',
    answer:
      "The platform supports subject access exports and erasure requests. These are handled within each school's policy and the platform's privacy obligations.",
  },
];

function FaqSection() {
  return (
    <section className="border-y bg-muted/40">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="FAQ"
            title="Questions schools ask us."
            description="A few practical answers before you speak with our team."
          />
          <p className="mt-6 text-sm text-muted-foreground">
            Still have a question?{' '}
            <Link
              to="/contact"
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
            >
              Talk to our team
            </Link>
            .
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <Accordion type="single" collapsible className="rounded-xl border bg-card px-6">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={faq.question}
                value={`faq-${index}`}
                className={index === faqs.length - 1 ? 'border-b-0' : undefined}
              >
                <AccordionTrigger className="text-left hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="leading-6 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-slate-950 px-6 py-12 text-white sm:px-10 lg:px-14">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-primary/15 blur-3xl"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                See how {BRAND} fits your school.
              </h2>
              <p className="text-slate-300">
                Book a short walkthrough with our team, or explore published courses at your own
                pace.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/contact?kind=DEMO">
                  Request a demo <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link to="/catalog">Browse courses</Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function HomeContent() {
  return (
    <>
      <HomeHero />
      <RoleStrip />
      <FeatureSection />
      <ProcessSection />
      <SecuritySection />
      <FaqSection />
      <CallToAction />
    </>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="border-b bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{description}</p>
        </motion.div>
      </div>
    </section>
  );
}

const glanceItems = [
  'Role-specific tools for five school roles',
  'Courses, assessments, progress, and certificates',
  'School-level data separation',
  'Privacy-friendly defaults',
];

function AboutContent() {
  return (
    <>
      <PageIntro
        eyebrow={`About ${BRAND}`}
        title="Technology to support better organised learning."
        description="A shared digital workspace for course delivery, classroom organisation, assessment, and progress."
      />

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.5fr_0.5fr] lg:px-8">
        <Reveal className="space-y-5">
          <p className="text-base leading-7 text-muted-foreground">
            {BRAND} brings course delivery, classroom organisation, assessments, and progress into
            a shared digital workspace. The platform is designed for school communities, with
            role-specific tools for administrators, coordinators, teachers, and students.
          </p>
          <p className="text-base leading-7 text-muted-foreground">
            Schools retain their own working context while platform administrators manage the
            broader service. Student learning features include courses, lessons, quizzes,
            assignments, and certificates where enabled by their school.
          </p>
          <div className="pt-2">
            <Button asChild>
              <Link to="/programmes">
                Explore programmes <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <aside className="rounded-xl border bg-card p-6">
            <h2 className="text-sm font-semibold">At a glance</h2>
            <ul className="mt-4 space-y-3">
              {glanceItems.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </aside>
        </Reveal>
      </section>
    </>
  );
}

const programmes = [
  {
    icon: School,
    title: 'School operations',
    text: 'Keep the day-to-day structure of the school in one place.',
    points: ['Classes and user management', 'Teacher allocations', 'Coordinator oversight'],
  },
  {
    icon: BookOpen,
    title: 'Teaching and courses',
    text: 'Structure learning material and assessment around each class.',
    points: ['Course and lesson builder', 'Quizzes and assignments', 'Class-based publishing'],
  },
  {
    icon: GraduationCap,
    title: 'Student learning',
    text: 'Give students a clear view of what to do next and how they are progressing.',
    points: ['Assigned courses and activities', 'Progress tracking', 'Certificates where enabled'],
  },
];

function ProgrammesContent() {
  return (
    <>
      <PageIntro
        eyebrow="Programmes"
        title="A connected toolkit for school learning."
        description="The platform brings together the day-to-day parts of teaching and learning. Availability depends on each school's setup."
      />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-3">
          {programmes.map((programme, index) => (
            <Reveal key={programme.title} delay={index * 0.05} className="h-full">
              <article className="flex h-full flex-col rounded-xl border bg-card p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/50 text-primary">
                  <programme.icon className="h-5 w-5" aria-hidden />
                </span>
                <h2 className="mt-4 text-lg font-semibold tracking-tight">{programme.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{programme.text}</p>
                <ul className="mt-5 space-y-2 border-t pt-4">
                  {programme.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-2 text-sm leading-6 text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 rounded-xl border bg-muted/40 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Availability depends on each school's setup and the features enabled for it.
          </p>
          <Button asChild>
            <Link to="/contact?kind=DEMO">
              Discuss a school demo <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}

function CourseSkeleton() {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading courses
      </p>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((item) => (
          <div key={item} className="animate-pulse rounded-xl border bg-card p-6">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-4 h-5 w-3/4 rounded bg-muted" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-5/6 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
            <div className="mt-6 h-4 w-32 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CatalogContent() {
  const courses = useQuery({ queryKey: ['public', 'courses'], queryFn: listPublicCourses });

  return (
    <>
      <PageIntro
        eyebrow="Course catalogue"
        title="Explore published courses."
        description="Only courses released for public discovery appear here."
      />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        {courses.isPending ? <CourseSkeleton /> : null}

        {courses.isError ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
          >
            <p className="font-medium">Courses could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">Please try again in a moment.</p>
            <Button variant="outline" className="mt-4" onClick={() => void courses.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}

        {courses.data?.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-16 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-4 font-medium">No public courses yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              New courses will appear here when schools publish them for public discovery.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to="/contact">Talk to our team</Link>
            </Button>
          </div>
        ) : null}

        {courses.data?.length ? (
          <>
            <p className="text-sm text-muted-foreground">
              {courses.data.length} {courses.data.length === 1 ? 'course' : 'courses'} available
            </p>
            <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {courses.data.map((course, index) => (
                <Reveal key={course.id} delay={index * 0.04} className="h-full">
                  <article className="flex h-full flex-col rounded-xl border bg-card p-6 transition-colors hover:border-primary/40">
                    <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden />
                      {course.subject || 'Course'}
                    </p>
                    <h2 className="mt-3 text-lg font-semibold leading-snug tracking-tight">
                      {course.title}
                    </h2>
                    <p className="mt-2 line-clamp-4 flex-1 text-sm leading-6 text-muted-foreground">
                      {course.description ||
                        'Course information will be shared by the school.'}
                    </p>
                    <Link
                      to="/contact?kind=DEMO"
                      className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-primary"
                    >
                      Ask about this course <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </article>
                </Reveal>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

function Field({
  htmlFor,
  label,
  required = false,
  hint,
  children,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-medium">
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        )}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function EnquiryForm({ initialKind = 'GENERAL' }: { initialKind?: PublicEnquiryInput['kind'] }) {
  const [values, setValues] = useState({
    name: '',
    email: '',
    phone: '',
    organisation: '',
    kind: initialKind as PublicEnquiryInput['kind'],
    message: '',
  });
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState(false);

  const enquiry = useMutation({
    mutationFn: submitPublicEnquiry,
    onSuccess: () => {
      setValues({
        name: '',
        email: '',
        phone: '',
        organisation: '',
        kind: initialKind,
        message: '',
      });
      setConsent(false);
      setSent(true);
      toast.success('Your message has been received.');
    },
    onError: () => toast.error('We could not send your message. Please try again.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) {
      toast.error('Please agree to the privacy notice before submitting.');
      return;
    }
    enquiry.mutate({ ...values, consent: true });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border bg-muted/40 p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
          <Check className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h3 className="text-base font-semibold">Message received</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Thanks. Our team will be in touch using the details you provided.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setSent(false)}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} aria-busy={enquiry.isPending}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field htmlFor="enquiry-name" label="Name" required>
          <input
            id="enquiry-name"
            className={inputClass}
            autoComplete="name"
            placeholder="Your full name"
            required
            minLength={2}
            maxLength={120}
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </Field>
        <Field htmlFor="enquiry-email" label="Email" required>
          <input
            id="enquiry-email"
            className={inputClass}
            type="email"
            autoComplete="email"
            placeholder="you@school.org"
            required
            maxLength={255}
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
          />
        </Field>
        <Field htmlFor="enquiry-phone" label="Phone">
          <input
            id="enquiry-phone"
            className={inputClass}
            type="tel"
            autoComplete="tel"
            placeholder="Contact number"
            maxLength={40}
            value={values.phone}
            onChange={(event) => setValues({ ...values, phone: event.target.value })}
          />
        </Field>
        <Field htmlFor="enquiry-organisation" label="School or organisation">
          <input
            id="enquiry-organisation"
            className={inputClass}
            autoComplete="organization"
            placeholder="School name"
            maxLength={160}
            value={values.organisation}
            onChange={(event) => setValues({ ...values, organisation: event.target.value })}
          />
        </Field>
      </div>

      <Field htmlFor="enquiry-kind" label="What is this about?" required>
        <select
          id="enquiry-kind"
          className={inputClass}
          value={values.kind}
          onChange={(event) =>
            setValues({ ...values, kind: event.target.value as PublicEnquiryInput['kind'] })
          }
        >
          <option value="GENERAL">General enquiry</option>
          <option value="DEMO">Request a demo</option>
        </select>
      </Field>

      <Field
        htmlFor="enquiry-message"
        label="Message"
        required
        hint="Please include any relevant details, such as year groups or subjects."
      >
        <textarea
          id="enquiry-message"
          className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          placeholder="How can we help?"
          required
          minLength={10}
          maxLength={4000}
          value={values.message}
          onChange={(event) => setValues({ ...values, message: event.target.value })}
        />
      </Field>

      <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          required
        />
        <span>
          I agree that {BRAND} may use these details to respond to my enquiry.
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        </span>
      </label>

      <Button type="submit" className="w-full sm:w-auto" disabled={enquiry.isPending || !consent}>
        {enquiry.isPending ? 'Sending...' : 'Send enquiry'}
        {enquiry.isPending ? null : <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}

const contactPoints = [
  {
    icon: Mail,
    title: 'General enquiries',
    text: 'Questions about the platform, courses, or school access.',
  },
  {
    icon: School,
    title: 'Demo requests',
    text: 'Tell us about your school and the programmes you are interested in.',
  },
  {
    icon: ShieldCheck,
    title: 'Your details',
    text: 'Information is used only to respond to this enquiry.',
  },
];

function ContactContent({ requestedKind }: { requestedKind: PublicEnquiryInput['kind'] }) {
  return (
    <>
      <PageIntro
        eyebrow="Contact"
        title={
          requestedKind === 'DEMO'
            ? `See how ${BRAND} can fit your school.`
            : "Let's talk about learning."
        }
        description="Send a question or request a demonstration. Our team will use your details only to respond to this enquiry."
      />

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <Reveal className="space-y-6">
          <div className="space-y-5">
            {contactPoints.map((point) => (
              <div key={point.title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <point.icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">{point.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{point.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border bg-muted/40 p-5">
            <p className="text-sm font-medium">What happens next</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Our team reviews your enquiry and replies using the contact details you provide. Demo
              requests usually include a short walkthrough of the platform.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="rounded-xl border bg-card p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-lg font-semibold tracking-tight">Send an enquiry</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Fields marked with <span className="text-destructive">*</span> are required.
              </p>
            </div>
            <EnquiryForm key={requestedKind} initialKind={requestedKind} />
          </div>
        </Reveal>
      </section>
    </>
  );
}

function PublicFooter() {
  const platformLinks = [
    { title: 'About', href: '/about' },
    { title: 'Programmes', href: '/programmes' },
    { title: 'Course catalogue', href: '/catalog' },
  ];
  const accessLinks = [
    { title: 'Sign in', href: '/login' },
    { title: 'Contact', href: '/contact' },
    { title: 'Request a demo', href: '/contact?kind=DEMO' },
  ];

  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div className="max-w-sm space-y-4">
            <Brand />
            <p className="text-sm leading-6 text-muted-foreground">
              A digital learning space for schools, educators, and students to organise courses,
              learning activities, and progress in one place.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider">Platform</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {platformLinks.map((item) => (
                <li key={item.href}>
                  <Link to={item.href} className="transition-colors hover:text-foreground">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider">Get started</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {accessLinks.map((item) => (
                <li key={item.href}>
                  <Link to={item.href} className="transition-colors hover:text-foreground">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {BRAND}. All rights reserved.
          </p>
          <p>Designed for school communities.</p>
        </div>
      </div>
    </footer>
  );
}

export function PublicSitePage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedKind = searchParams.get('kind') === 'DEMO' ? 'DEMO' : 'GENERAL';
  const path = location.pathname;

  let content: ReactNode;
  if (path === '/') {
    content = <HomeContent />;
  } else if (path === '/about') {
    content = <AboutContent />;
  } else if (path === '/catalog') {
    content = <CatalogContent />;
  } else if (path === '/programmes') {
    content = <ProgrammesContent />;
  } else {
    content = <ContactContent requestedKind={requestedKind} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <PublicHeader />
      <main id="main-content">{content}</main>
      <PublicFooter />
    </div>
  );
}
