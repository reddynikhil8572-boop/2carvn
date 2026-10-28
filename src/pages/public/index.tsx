import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, GraduationCap, Menu, School, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

import { listPublicCourses, submitPublicEnquiry, type PublicEnquiryInput } from '@/api/public';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/hooks/useAuth';

const publicLinks = [
  { title: 'About', href: '/about' },
  { title: 'Courses', href: '/catalog' },
  { title: 'Programmes', href: '/programmes' },
  { title: 'Contact', href: '/contact' },
];

const inputClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function PublicHeader() {
  const { authenticated, loading } = useSession();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-foreground" aria-label="2CaRvN home">
          <motion.span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            whileHover={{ scale: 1.1, rotate: -5, transition: { duration: 0.2 } }}
            whileTap={{ scale: 0.95 }}
          >
            2C
          </motion.span>
          <span>2CaRvN</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex" aria-label="Main navigation">
          {publicLinks.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="group relative text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.title}
              <span className="absolute -bottom-1 left-0 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 group-hover:w-full" />
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <details className="relative md:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border" aria-label="Open navigation menu">
              <Menu className="h-4 w-4" aria-hidden />
            </summary>
            <nav className="absolute right-0 top-11 z-20 grid min-w-40 gap-2 rounded-lg border bg-background p-3 shadow-lg" aria-label="Mobile navigation">
              {publicLinks.map((item) => <Link key={item.href} to={item.href} className="rounded px-2 py-1 text-sm hover:bg-muted">{item.title}</Link>)}
            </nav>
          </details>
          <Button asChild size="sm"><Link to={authenticated ? '/dashboard' : '/login'}>{loading ? 'Loading\u2026' : authenticated ? 'Dashboard' : 'Sign in'}</Link></Button>
        </div>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>2CaRvN learning platform</p>
        <nav className="flex flex-wrap gap-4" aria-label="Footer navigation">
          {publicLinks.map((item) => <Link key={item.href} to={item.href} className="hover:text-foreground">{item.title}</Link>)}
          <Link to="/login" className="hover:text-foreground">Sign in</Link>
        </nav>
      </div>
    </footer>
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
  const enquiry = useMutation({
    mutationFn: submitPublicEnquiry,
    onSuccess: () => {
      setValues({ name: '', email: '', phone: '', organisation: '', kind: initialKind, message: '' });
      setConsent(false);
      toast.success('Thanks \u2014 your message has been received.');
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

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">Name
          <input className={inputClass} autoComplete="name" required minLength={2} maxLength={120} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">Email
          <input className={inputClass} type="email" autoComplete="email" required maxLength={255} value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">Phone (optional)
          <input className={inputClass} type="tel" autoComplete="tel" maxLength={40} value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">School or organisation (optional)
          <input className={inputClass} autoComplete="organization" maxLength={160} value={values.organisation} onChange={(event) => setValues({ ...values, organisation: event.target.value })} />
        </label>
      </div>
      <label className="grid gap-1.5 text-sm font-medium">What is this about?
        <select className={inputClass} value={values.kind} onChange={(event) => setValues({ ...values, kind: event.target.value as PublicEnquiryInput['kind'] })}>
          <option value="GENERAL">General enquiry</option>
          <option value="DEMO">Request a demo</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">Message
        <textarea className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" required minLength={10} maxLength={4000} value={values.message} onChange={(event) => setValues({ ...values, message: event.target.value })} />
      </label>
      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
        I agree that 2CaRvN may use these details to respond to my enquiry.
      </label>
      <Button type="submit" disabled={enquiry.isPending || !consent}>
        {enquiry.isPending ? 'Sending\u2026' : 'Send enquiry'} <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
}

const featureCards = [
  { icon: BookOpen, title: 'Structured learning', text: 'Courses, lessons, quizzes, and assignments.' },
  { icon: GraduationCap, title: 'Student progress', text: 'Learning activities and achievement records.' },
  { icon: School, title: 'School workspace', text: 'Tools organised around school communities.' },
  { icon: ShieldCheck, title: 'Role-based access', text: 'Purposeful access for each platform role.' },
];

function HomeContent() {
  return (
    <>
      <section className="relative overflow-hidden bg-[#101a2d] text-white">
        {/* Ambient animated orbs — decorative only */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-indigo-500/15 blur-3xl"
          animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
        />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1.2fr_0.8fr] md:items-center lg:px-8 lg:py-28">
          <div className="space-y-6">
            <motion.p
              className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              Learning, connected
            </motion.p>
            <motion.h1
              className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            >
              A clearer path from teaching to achievement.
            </motion.h1>
            <motion.p
              className="max-w-2xl text-lg leading-8 text-slate-300"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              A digital learning space for schools, educators, and students to organise courses, learning activities, and progress in one place.
            </motion.p>
            <motion.div
              className="flex flex-wrap gap-3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                <Button asChild size="lg"><Link to="/contact?kind=DEMO">Request a demo</Link></Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                <Button asChild size="lg" variant="outline" className="border-slate-500 bg-transparent text-white hover:bg-white/10 hover:text-white">
                  <Link to="/catalog">Explore courses</Link>
                </Button>
              </motion.div>
            </motion.div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {featureCards.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.35 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -5, scale: 1.03, transition: { duration: 0.2 } }}
              >
                <Card className="border-white/10 bg-white/5 text-white shadow-none transition-colors hover:bg-white/10">
                  <CardHeader>
                    <motion.div whileHover={{ rotate: [0, -10, 10, 0], transition: { duration: 0.4 } }}>
                      <item.icon className="mb-3 h-6 w-6 text-orange-300" aria-hidden />
                    </motion.div>
                    <CardTitle>{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-slate-300">{item.text}</CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-2 lg:px-8">
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">For the learning community</p>
          <h2 className="text-3xl font-semibold tracking-tight">Bring the learning journey together.</h2>
          <p className="leading-7 text-muted-foreground">Explore the platform, discover published courses, or talk with our team about a school demonstration.</p>
        </motion.div>
        <motion.div
          className="flex flex-wrap items-center gap-3 md:justify-end"
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <Button asChild variant="outline"><Link to="/about">About the platform</Link></Button>
          <Button asChild><Link to="/contact">Contact us</Link></Button>
        </motion.div>
      </section>
    </>
  );
}

export function PublicSitePage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCatalog = location.pathname === '/catalog';
  const courses = useQuery({ queryKey: ['public', 'courses'], queryFn: listPublicCourses, enabled: isCatalog });
  const requestedKind = searchParams.get('kind') === 'DEMO' ? 'DEMO' : 'GENERAL';
  const path = location.pathname;

  let content;
  if (path === '/') {
    content = <HomeContent />;
  } else if (path === '/about') {
    content = (
      <motion.section
        className="mx-auto max-w-4xl space-y-6 px-4 py-16 sm:px-6 lg:py-24"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">About 2CaRvN</p>
        <h1 className="text-4xl font-bold tracking-tight">Technology to support better organised learning.</h1>
        <p className="text-lg leading-8 text-muted-foreground">2CaRvN brings course delivery, classroom organisation, assessments, and progress into a shared digital workspace. The platform is designed for school communities, with role-specific tools for administrators, organisers, teachers, coordinators, and students.</p>
        <p className="leading-7 text-muted-foreground">Schools retain their own working context while platform administrators manage the broader service. Student learning features include courses, lessons, quizzes, assignments, and certificates where enabled by their school.</p>
        <Button asChild><Link to="/programmes">Explore programmes</Link></Button>
      </motion.section>
    );
  } else if (isCatalog) {
    content = (
      <section className="mx-auto max-w-7xl space-y-8 px-4 py-14 sm:px-6 lg:px-8">
        <motion.div
          className="max-w-2xl space-y-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Course catalogue</p>
          <h1 className="text-4xl font-bold tracking-tight">Explore published courses.</h1>
          <p className="text-muted-foreground">Only courses released for public discovery appear here.</p>
        </motion.div>
        {courses.isPending ? <p role="status" className="text-muted-foreground">Loading courses\u2026</p> : null}
        {courses.isError ? <div role="alert" className="space-y-3"><p>Courses could not be loaded.</p><Button variant="outline" onClick={() => void courses.refetch()}>Try again</Button></div> : null}
        {courses.data?.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">There are no public courses available yet.</p> : null}
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {courses.data?.map((course, i) => (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
            >
              <Card>
                <CardHeader><CardTitle>{course.title}</CardTitle><CardDescription>{course.subject || 'Course'}</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">{course.description || 'Course information will be shared by the school.'}</p>
                  <Button asChild variant="outline" size="sm"><Link to="/contact?kind=DEMO">Ask about this course</Link></Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>
    );
  } else if (path === '/programmes') {
    content = (
      <section className="mx-auto max-w-7xl space-y-10 px-4 py-14 sm:px-6 lg:px-8">
        <motion.div
          className="max-w-3xl space-y-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Programmes</p>
          <h1 className="text-4xl font-bold tracking-tight">A connected toolkit for school learning.</h1>
          <p className="text-lg text-muted-foreground">The platform brings together the day-to-day parts of teaching and learning; availability depends on each school's setup.</p>
        </motion.div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { icon: School, title: 'School operations', text: 'Organise classes, users, and teacher allocations across the school.' },
            { icon: BookOpen, title: 'Teaching and courses', text: 'Structure course material into lessons, assignments, and assessments.' },
            { icon: GraduationCap, title: 'Student learning', text: 'Access assigned learning, complete activities, and track achievements.' },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
            >
              <Card>
                <CardHeader><item.icon className="mb-3 h-6 w-6 text-primary" aria-hidden /><CardTitle>{item.title}</CardTitle></CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">{item.text}</CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
        <Button asChild><Link to="/contact?kind=DEMO">Discuss a school demo</Link></Button>
      </section>
    );
  } else {
    content = (
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <motion.div
          className="space-y-4"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Contact</p>
          <h1 className="text-4xl font-bold tracking-tight">{requestedKind === 'DEMO' ? 'See how 2CaRvN can fit your school.' : "Let\u2019s talk about learning."}</h1>
          <p className="leading-7 text-muted-foreground">Send a question or request a demonstration. Our team will use your details only to respond to this enquiry.</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Send an enquiry</CardTitle>
              <CardDescription>Required fields are marked by your browser's form validation.</CardDescription>
            </CardHeader>
            <CardContent><EnquiryForm key={requestedKind} initialKind={requestedKind} /></CardContent>
          </Card>
        </motion.div>
      </section>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main>{content}</main>
      <PublicFooter />
    </div>
  );
}
