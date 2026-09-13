import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { AuthLayout } from '@/pages/auth/auth-layout';
import { useTwoFactorVerify } from '@/hooks/useAuth';
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
  code: z
    .string()
    .trim()
    .min(6, 'Enter the 6-digit code from your authenticator app')
    .max(20),
});

type Values = z.infer<typeof schema>;

export function TwoFactorPage() {
  const location = useLocation();
  const verify = useTwoFactorVerify();
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const state = location.state as {
    challengeToken?: string;
    email?: string;
  } | null;

  const challengeToken = state?.challengeToken ?? '';
  const email = state?.email;

  const hasChallenge = useMemo(() => challengeToken.length > 0, [challengeToken]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  // The challenge token is passed through navigation state from /login. If the
  // user lands here directly (browser reload on /2fa), go re-authenticate.
  if (!hasChallenge) {
    return (
      <AuthLayout
        footer={
          <Link className="font-medium text-primary hover:underline" to="/login">
            Back to sign in
          </Link>
        }
      >
        <h1 className="text-2xl font-semibold tracking-tight">Session expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your sign-in session expired while waiting for verification. Please sign in again.
        </p>
      </AuthLayout>
    );
  }

  async function onSubmit(values: Values) {
    setServerMessage(null);
    try {
      await verify.mutateAsync({ challengeToken, code: values.code });
      // Verification navigates to '/'.
    } catch (error) {
      const parsed = normaliseError(error);
      setServerMessage(parsed.message);
      if (typeof parsed.meta.reason === 'string') {
        toast.error(parsed.meta.reason);
      }
    }
  }

  return (
    <AuthLayout
      footer={
        <Link className="font-medium text-primary hover:underline" to="/login">
          Use a different account
        </Link>
      }
    >
      <div className="mb-6 flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 text-primary" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Two-factor verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {email ? (
              <>
                Enter the 6-digit code from your authenticator app for{' '}
                <span className="font-medium text-foreground">{email}</span>.
              </>
            ) : (
              'Enter the 6-digit code from your authenticator app.'
            )}
          </p>
        </div>
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
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Verification code</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    className="text-center text-lg tracking-[0.4em]"
                    maxLength={20}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Losing access to your authenticator app? Recovery codes also work here.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={verify.isPending}>
            {verify.isPending ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}