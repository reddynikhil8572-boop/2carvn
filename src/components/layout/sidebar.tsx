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

const navItemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

export function Sidebar({ role, brand = '2carvn' }: SidebarProps) {
  const groups = navFor(role);

  return (
    <div className="flex h-full flex-col">
      <motion.div
        className="flex h-16 shrink-0 items-center gap-2 px-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.span
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1, transition: { duration: 0.4 } }}
        >
          <GraduationCap className="h-4 w-4" aria-hidden />
        </motion.span>
        <span className="text-base font-semibold tracking-tight">{brand}</span>
      </motion.div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-6 p-4" aria-label="Main navigation">
          {groups.map((group, groupIndex) => (
            <div key={group.label}>
              <motion.p
                className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: groupIndex * 0.08 + 0.1 }}
              >
                {group.label}
              </motion.p>
              <ul className="space-y-1">
                {group.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  const globalIndex = groupIndex * 10 + itemIndex;
                  return (
                    <motion.li
                      key={item.href}
                      custom={globalIndex}
                      variants={navItemVariants}
                      initial="hidden"
                      animate="visible"
                    >
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
                            <motion.span
                              whileHover={{ scale: 1.2, rotate: -5, transition: { duration: 0.2 } }}
                            >
                              <Icon
                                className={cn(
                                  'h-4 w-4 transition-colors group-hover:text-foreground',
                                  isActive && 'text-primary',
                                )}
                                aria-hidden
                              />
                            </motion.span>
                            <span className="truncate">{item.title}</span>
                          </>
                        )}
                      </NavLink>
                    </motion.li>
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