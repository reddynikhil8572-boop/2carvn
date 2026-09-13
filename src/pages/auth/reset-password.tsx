import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';

import { AuthLayout } from '@/pages/auth/auth-layout';
import { useResetPassword } from '@/hooks/useAuth';
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

// Mirrors backend-v2 passwordSchema (validators/auth.validator.ts).
const schema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/\d/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type Values = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const reset = useResetPassword();
  const [done, setDone] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  // A route without a token cannot do anything useful.
  if (!token) {
    return <InvalidToken />;
  }

  async function onSubmit(values: Values) {
    setServerMessage(null);
    try {
      await reset.mutateAsync({ token, password: values.password });
      setDone(true);
    } catch (error) {
      setServerMessage(normaliseError(error).message);
    }
  }

  if (done) {
    return (
      <AuthLayout
        footer={
          <Link className="font-medium text-primary hover:underline" to="/login">
            Sign in now
          </Link>
        }
      >
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Your password has been reset. You can now sign in with the new one.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      footer={
        <>
          Remembered it?{' '}
          <Link className="font-medium text-primary hover:underline" to="/login">
            Back to sign in
          </Link>
        </>
      }
    >
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Must meet the platform password policy.</p>
      </div>

      {serverMessage ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {serverMessage} If the link is stale, request a fresh one.
        </div>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormDescription>8+ characters with upper, lower, number and symbol.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={reset.isPending}>
            {reset.isPending ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}

function InvalidToken() {
  return (
    <AuthLayout
      footer={
        <Link className="font-medium text-primary hover:underline" to="/forgot-password">
          Request a new link
        </Link>
      }
    >
      <h1 className="text-2xl font-semibold tracking-tight">Invalid or missing link</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This reset link is missing or malformed. Use the “forgot password” flow to get a fresh one.
      </p>
    </AuthLayout>
  );
}