import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Moon, ShieldCheck, Sun, User } from 'lucide-react';

import { cn, roleLabel } from '@/lib/utils';
import { useAuthUser } from '@/stores/auth';
import { useLogout } from '@/hooks/useAuth';
import { useTheme } from '@/components/theme/theme-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Sidebar } from '@/components/layout/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function themeLabel(): 'Light' | 'Dark' {
  // Static import would evaluate too early; read live from the DOM at render.
  return document.documentElement.classList.contains('dark') ? 'Light' : 'Dark';
}

export function Header() {
  const user = useAuthUser();
  const { setTheme } = useTheme();
  const logout = useLogout();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Flip to the opposite of whatever the OS/browser resolved to.
  const isDark = themeLabel() === 'Dark';

  const initials = user ? user.name.split(' ').map((p) => p[0]).slice(0, 2).join('') : '?';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-sidebar/95 px-4 backdrop-blur sm:px-6">
      {/* Mobile nav trigger */}
      <span className="lg:hidden">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">2carvn navigation</SheetDescription>
            <Sidebar role={user?.role ?? 'STUDENT'} />
          </SheetContent>
        </Sheet>
      </span>

      <div className="min-w-0 flex-1">
        {user && (
          <p className="truncate text-sm text-muted-foreground">
            {roleLabel(user.role)}
            {user.schoolId ? ' · ' : ''}
          </p>
        )}
      </div>

      {/* Theme toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6" />

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
            <Avatar className="h-7 w-7">
              {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className={cn('hidden text-sm font-medium sm:inline')}>
              {user?.name ?? 'Account'}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{user?.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/settings')}>
            <User className="mr-2" /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/settings/security')}>
            <ShieldCheck className="mr-2" /> Security &amp; 2FA
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={logout.isPending}
            onSelect={() => logout.mutate()}
          >
            <LogOut className="mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}