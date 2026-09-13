import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Copy, KeyRound, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';

import {
  useTwoFactorStatus,
  useTwoFactorSetup,
  useTwoFactorEnable,
  useTwoFactorDisable,
  useRegenerateRecoveryCodes,
} from '@/hooks/useAuth';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const passwordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});
type PasswordValues = z.infer<typeof passwordSchema>;

const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your app'),
});
type CodeValues = z.infer<typeof codeSchema>;

/** Copiable monospace row for secrets and recovery codes. */
function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded bg-muted px-2 py-1 text-sm tracking-wider">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error('Could not copy — copy manually from the box.');
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </span>
  );
}

function RecoveryCodeBox({ codes }: { codes: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="rounded-lg border-2 border-warning/40 bg-warning/5 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="space-y-2">
          <p className="text-sm font-medium text-warning">Save these recovery codes now</p>
          <p className="text-xs text-muted-foreground">
            Each can be used once to sign in if you lose your authenticator app. They won't be shown again.
          </p>
          <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
            {codes.map((code) => (
              <div key={code}>
                <CopyRow value={code} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setDismissed(true)}>
            I've saved these codes
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SecuritySettingsPage() {
  const status = useTwoFactorStatus();
  const setup = useTwoFactorSetup();
  const enable = useTwoFactorEnable();
  const disable = useTwoFactorDisable();
  const regenerate = useRegenerateRecoveryCodes();

  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupOtpUri, setSetupOtpUri] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Dialogs
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);

  const twoFactor = status.data;

  const disableForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '' },
  });
  const regenerateForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '' },
  });
  const enableForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });

  async function handleSetup() {
    setRecoveryCodes(null);
    try {
      const result = await setup.mutateAsync();
      setSetupSecret(result.secret);
      setSetupOtpUri(result.otpauthUri);
      enableForm.reset();
    } catch {
      /* global toast covers failure */
    }
  }

  async function handleEnable(values: CodeValues) {
    try {
      const result = await enable.mutateAsync(values);
      toast.success('Two-factor authentication enabled.');
      setSetupSecret(null);
      setSetupOtpUri(null);
      enableForm.reset();
      setRecoveryCodes(result.recoveryCodes ?? null);
    } catch {
      /* failure surfaced by the global mutation toast */
    }
  }

  async function handleDisable(values: PasswordValues) {
    try {
      await disable.mutateAsync({ password: values.password });
      toast.success('Two-factor authentication disabled.');
      setDisableOpen(false);
      disableForm.reset();
    } catch {}
  }

  async function handleRegenerate(values: PasswordValues) {
    try {
      const result = await regenerate.mutateAsync({ password: values.password });
      setRegenerateOpen(false);
      regenerateForm.reset();
      const codes = result.recoveryCodes;
      setRecoveryCodes(codes ?? null);
      toast.success('Recovery codes regenerated.');
    } catch {}
  }

  const loading = status.isLoading;
  const statusError = status.error;
  const refetchStatus = status.refetch;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Two-factor authentication and recovery for your account."
      />

      {/* 2FA status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-base">Two-factor authentication</CardTitle>
            </div>
            {loading ? (
              <Badge variant="secondary">Checking…</Badge>
            ) : statusError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : twoFactor?.enabled ? (
              <Badge variant="success">Enabled</Badge>
            ) : (
              <Badge variant="warning">Not enabled</Badge>
            )}
          </div>
          <CardDescription>
            Add an extra step to sign-in. Requires an authenticator app such as Google
            Authenticator or Authy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusError ? (
            <ErrorState
              title="Couldn't load 2FA status"
              description="We couldn't check your two-factor setup. Retry when you're back online."
              onRetry={refetchStatus}
            />
          ) : twoFactor?.enabled ? (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <KeyRound className="h-4 w-4" aria-hidden />
                <span>
                  {twoFactor.remainingRecoveryCodes} recovery{' '}
                  {twoFactor.remainingRecoveryCodes === 1 ? 'code' : 'codes'} remaining.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setRegenerateOpen(true)}>
                  <RefreshCw className="mr-1" aria-hidden /> Regenerate recovery codes
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    disableForm.reset();
                    setDisableOpen(true);
                  }}
                >
                  Disable 2FA
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={handleSetup} disabled={setup.isPending}>
              {setup.isPending ? 'Generating…' : 'Set up two-factor authentication'}
            </Button>
          )}

          {/* Setup flow */}
          {setupSecret && setupOtpUri ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="rounded-lg bg-white p-2">
                  <QRCodeSVG value={setupOtpUri} size={140} level="M" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Scan with your authenticator app</p>
                  <p className="text-sm text-muted-foreground">
                    Or enter the secret manually:
                  </p>
                  <CopyRow value={setupSecret} />
                </div>
              </div>
              <Separator />
              <form
                onSubmit={enableForm.handleSubmit(handleEnable)}
                className="space-y-2"
                noValidate
              >
                <Label htmlFor="2fa-code">Enter the 6-digit code from the app</Label>
                <div className="flex gap-2">
                  <Input
                    id="2fa-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="••••••"
                    className="w-40 tracking-[0.3em]"
                    {...enableForm.register('code')}
                  />
                  <Button type="submit" disabled={enable.isPending}>
                    {enable.isPending ? 'Enabling…' : 'Enable'}
                  </Button>
                </div>
                {enableForm.formState.errors.code ? (
                  <p className="text-xs font-medium text-destructive">
                    {enableForm.formState.errors.code.message}
                  </p>
                ) : null}
              </form>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {recoveryCodes ? <RecoveryCodeBox codes={recoveryCodes} /> : null}

      {/* Disable dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>
              Confirm with your password. Your account becomes less secure once 2FA is off.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={disableForm.handleSubmit(handleDisable)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="disable-password">Password</Label>
              <Input
                id="disable-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                {...disableForm.register('password')}
              />
              {disableForm.formState.errors.password ? (
                <p className="text-xs font-medium text-destructive">
                  {disableForm.formState.errors.password.message}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDisableOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={disable.isPending}>
                {disable.isPending ? 'Disabling…' : 'Disable'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Regenerate dialog */}
      <Dialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate recovery codes</DialogTitle>
            <DialogDescription>
              Old codes stop working immediately. Confirm with your password to issue new ones.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={regenerateForm.handleSubmit(handleRegenerate)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="regen-password">Password</Label>
              <Input
                id="regen-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                {...regenerateForm.register('password')}
              />
              {regenerateForm.formState.errors.password ? (
                <p className="text-xs font-medium text-destructive">
                  {regenerateForm.formState.errors.password.message}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRegenerateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={regenerate.isPending}>
                {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}