import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap } from 'lucide-react';

import { cn } from '@/lib/utils';
import { navFor } from '@/components/layout/nav';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { UserRole } from '@/types/api';

interface SidebarProps {
  role: UserRole;
  /** App brand shown above the nav. */
  brand?: string;
}

export function Sidebar({ role, brand = '2carvn' }: SidebarProps) {
  const groups = navFor(role);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-base font-semibold tracking-tight">{brand}</span>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-6 p-4" aria-label="Main navigation">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <NavLink
                        to={item.href}
                        end={item.href === '/dashboard'}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            'hover:bg-accent hover:text-accent-foreground',
                            isActive
                              ? 'bg-accent text-accent-foreground'
                              : 'text-muted-foreground',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <motion.span
                                layoutId="sidebar-active"
                                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                              />
                            )}
                            <Icon
                              className={cn(
                                'h-4 w-4 transition-colors group-hover:text-foreground',
                                isActive && 'text-primary',
                              )}
                              aria-hidden
                            />
                            <span className="truncate">{item.title}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>
      <Separator />
      <div className="p-4 text-xs text-muted-foreground">
        <p className="px-3">{brand} · Education platform</p>
      </div>
    </div>
  );
}