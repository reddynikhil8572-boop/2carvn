import { Link } from 'react-router-dom';
import { ShieldCheck, Volume2 } from 'lucide-react';

import { useSession } from '@/hooks/useAuth';
import { useAuthUser } from '@/stores/auth';
import { roleLabel } from '@/lib/utils';
import type { MeResponse } from '@/types/models';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTheme, type MotionLevel, type StudentTheme } from '@/components/theme/theme-provider';
import { playSuccessCue } from '@/lib/sound';

const studentThemes: Array<{ value: StudentTheme; title: string; detail: string; accent: string }> = [
  { value: 'classic', title: 'Classic', detail: 'Brand-orange study surfaces.', accent: 'bg-[#ff7a00]' },
  { value: 'cartoon', title: 'Cartoon world', detail: 'Bright mint, playful color, and rounded cards.', accent: 'bg-pink-500' },
  { value: 'anime', title: 'Anime world', detail: 'Lavender and manga-inspired accents.', accent: 'bg-violet-600' },
  { value: 'racing', title: 'Cars & bikes', detail: 'Dark motorsport surfaces with track-orange accents.', accent: 'bg-orange-500' },
];

const motionOptions: Array<{ value: MotionLevel; label: string }> = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'playful', label: 'Playful' },
];

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function SettingsPage() {
  const authUser = useAuthUser();
  const { user: sessionUser } = useSession();
  const {
    studentTheme,
    setStudentTheme,
    soundEnabled,
    setSoundEnabled,
    soundVolume,
    setSoundVolume,
    motionLevel,
    setMotionLevel,
    setTheme,
  } = useTheme();

  const user = authUser ?? sessionUser;
  const school = (
    sessionUser && 'school' in sessionUser ? sessionUser.school : undefined
  ) as MeResponse['school'] | undefined;

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account, school and security." />

      <div className="grid gap-6 lg:grid-cols-2">
        {user.role === 'STUDENT' ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Learning experience</CardTitle>
              <CardDescription>These preferences affect presentation only, never your courses, results, or access.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Choose a student theme</legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {studentThemes.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={studentTheme === option.value}
                      onClick={() => setStudentTheme(option.value)}
                      className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        studentTheme === option.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'
                      }`}
                    >
                      <span className={`mb-3 block h-2 rounded-full ${option.accent}`} aria-hidden />
                      <span className="block font-semibold">{option.title}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{option.detail}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-6 border-t pt-5 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-primary" aria-hidden />
                    <h3 className="text-sm font-medium">Sound feedback</h3>
                  </div>
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} />
                    Enable short sound effects (off by default)
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span>Volume</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={soundVolume}
                      onChange={(event) => setSoundVolume(Number(event.target.value))}
                      disabled={!soundEnabled}
                      aria-label="Sound effect volume"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!soundEnabled}
                    onClick={() => playSuccessCue(soundVolume)}
                  >
                    Preview sound
                  </Button>
                </div>
                <div className="space-y-3">
                  <label htmlFor="motion-level" className="text-sm font-medium">Animation level</label>
                  <select
                    id="motion-level"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={motionLevel}
                    onChange={(event) => setMotionLevel(event.target.value as MotionLevel)}
                  >
                    {motionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <p className="text-sm text-muted-foreground">
                    Minimal motion also respects and strengthens your device’s reduced-motion preference.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">Preferences are saved on this device. Sound plays only after you enable it.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setStudentTheme('classic');
                    setSoundEnabled(false);
                    setSoundVolume(0.3);
                    setMotionLevel('subtle');
                    setTheme('system');
                  }}
                >
                  Reset preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-12 w-12">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
                <AvatarFallback>{initialsFor(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold leading-tight">{user.name}</p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <Badge variant="secondary">{roleLabel(user.role)}</Badge>
            <p className="text-sm text-muted-foreground">
              Name and email changes are managed by your school administrator.
            </p>
          </CardContent>
        </Card>

        {school ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">School</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                {school.logoUrl ? (
                  <img
                    src={school.logoUrl}
                    alt={`${school.name} logo`}
                    className="h-10 w-10 rounded-md border border-border object-contain"
                  />
                ) : null}
                <p className="font-semibold">{school.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                  {school.schoolCode}
                </code>
                {school.primaryColor ? (
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-border"
                    style={{ backgroundColor: school.primaryColor ?? 'transparent' }}
                    aria-hidden
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-base">Security</CardTitle>
            </div>
            <CardDescription>
              Protect your account with two-factor authentication and recovery codes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/settings/security">Manage security & 2FA</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}