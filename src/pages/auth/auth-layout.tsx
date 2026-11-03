import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Shared frame for unauthenticated pages: brand panel on the left (desktop),
 * form column with animated entrance on the right.
 * Brand panel features floating glassmorphism orbs for visual depth.
 */
export function AuthLayout({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col gap-8 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-neutral-950 px-6 py-8 text-white sm:px-8 lg:flex lg:justify-between lg:p-12">
        {/* Floating glassmorphism orbs */}
        <motion.div
          className="absolute -top-20 -left-20 hidden h-80 w-80 rounded-full bg-amber-300/10 blur-3xl lg:block"
          animate={reduceMotion ? {} : { scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-10 right-0 hidden h-64 w-64 rounded-full bg-amber-500/10 blur-3xl lg:block"
          animate={reduceMotion ? {} : { scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 hidden h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-2xl lg:block"
          animate={reduceMotion ? {} : { x: [0, 20, -20, 0], y: [0, -15, 10, 0] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />

        <Link to="/" className="relative flex items-center gap-2">
          <motion.span
            className="flex items-center"
            whileHover={reduceMotion ? undefined : { scale: 1.04, transition: { duration: 0.2 } }}
          >
            <img
              src="/brand-wordmark-light.png"
              alt="2CaRvN"
              width={480}
              height={236}
              className="h-20 w-auto object-contain object-left"
            />
          </motion.span>
        </Link>

        <div className="relative">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-md text-3xl font-semibold leading-tight"
          >
            One platform for your whole school.
          </motion.h1>
          <motion.p
            className="mt-3 max-w-md text-white/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.5, delay: 0.2 }}
          >
            Courses, classes, quizzes and certificates — multi-tenant by design,
            with your data held behind strict row-level isolation.
          </motion.p>

          {/* Floating stat pills */}
          <div className="mt-8 flex flex-wrap gap-3">
            {[
              { label: 'Multi-tenant', value: '✓' },
              { label: 'Role-based', value: '✓' },
              { label: 'Privacy-first', value: '✓' },
            ].map((pill, i) => (
              <motion.div
                key={pill.label}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm backdrop-blur-sm"
                initial={{ opacity: 0, scale: 0.8, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.35 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                whileHover={reduceMotion ? undefined : { scale: 1.05, backgroundColor: 'rgba(255,255,255,0.18)' }}
              >
                <span className="font-semibold text-amber-300">{pill.value}</span>
                <span className="text-white/75">{pill.label}</span>
              </motion.div>
            ))}
          </div>
          <video
            className="mt-8 aspect-video w-full max-w-lg rounded-xl border border-amber-300/20 bg-black object-cover shadow-2xl shadow-black/40"
            src="/login-showcase.mp4"
            poster="/login-showcase-poster.jpg"
            autoPlay={!reduceMotion}
            muted
            loop
            controls
            playsInline
            disablePictureInPicture
            preload="metadata"
            aria-label="2CaRvN introduction video"
          />
        </div>

        <p className="relative text-xs text-white/50">
          2CaRvN · Privacy-friendly by default
        </p>
      </div>

      {/* Form column */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <Link to="/" aria-label="2CaRvN home" className="inline-flex">
              <img
                src="/brand-wordmark.png"
                alt="2CaRvN"
                width={480}
                height={236}
                className="h-10 w-auto object-contain"
              />
            </Link>
          </div>
          {children}
          {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}
        </motion.div>
      </div>
    </div>
  );
}