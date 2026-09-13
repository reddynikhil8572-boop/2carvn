import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';

import { AuthLayout } from '@/pages/auth/auth-layout';
import { useRequestPasswordReset } from '@/hooks/useAuth';
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

const schema = z.object({
  schoolCode: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v) => v || ''),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

type Values = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { schoolCode: '', email: '' },
  });

  async function onSubmit(values: Values) {
    setServerMessage(null);
    try {
      await requestReset.mutateAsync(values);
      setSentTo(values.email);
    } catch (error) {
      setServerMessage(normaliseError(error).message);
    }
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
      {sentTo ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>{' '}
            we've emailed a reset link. It expires after a short window — use it soon.
          </p>
          <Link
            className="inline-block text-sm font-medium text-primary hover:underline"
            to="/login"
          >
            Return to sign in
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your account email and we'll send you a reset link.
            </p>
          </div>

          {serverMessage ? (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {serverMessage}
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
                      <Input type="email" autoComplete="email" placeholder="you@school.edu" {...field} />
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
                      Required when your email exists at more than one school.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={requestReset.isPending}>
                {requestReset.isPending ? 'Sending link…' : 'Send reset link'}
              </Button>
            </form>
          </Form>
        </>
      )}
    </AuthLayout>
  );
}