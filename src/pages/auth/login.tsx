import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { AuthLayout } from '@/pages/auth/auth-layout';
import { useLogin } from '@/hooks/useAuth';
import { normaliseError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Lock, Mail, ShieldAlert } from 'lucide-react';

const loginSchema = z.object({
  schoolCode: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v) => v || ''),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { schoolCode: '', email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setServerMessage(null);
    try {
      const result = await login.mutateAsync(values);
      if (result.twoFactorRequired) {
        navigate('/2fa', {
          replace: true,
          state: {
            challengeToken: result.challengeToken,
            email: values.email,
            schoolCode: values.schoolCode,
          },
        });
      } else {
        navigate(from, { replace: true });
      }
    } catch (error) {
      const parsed = normaliseError(error);
      setServerMessage(parsed.message);

      // Surface lockout/attempts detail when the backend provides it.
      if (typeof parsed.meta.retryAfter === 'number') {
        toast.error(`Account temporarily locked. Try again in ${parsed.meta.retryAfter}s.`);
      } else if (typeof parsed.meta.attemptsRemaining === 'number') {
        toast.error(`${parsed.meta.attemptsRemaining} attempts remaining before lockout.`);
      }
    }
  }

  return (
    <AuthLayout
      footer={
        <>
          <Link className="font-medium text-primary hover:underline" to="/forgot-password">
            Forgot your password?
          </Link>
        </>
      }
    >
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use your school credentials. Staff — add your school code when you have one.
        </p>
      </div>

      {serverMessage ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{serverMessage}</span>
        </div>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="you@school.edu"
                      className="pl-9"
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="pl-9"
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="schoolCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>School code</FormLabel>
                <FormControl>
                  <Input
                    autoCapitalize="characters"
                    autoComplete="organization"
                    placeholder="e.g. WESTHILL"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Optional for staff sessions at a single school. Platform owners should leave it empty.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}