import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  KeyRound,
  ClipboardList,
  Building2,
  Mail,
  LogOut,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  Lock,
  Ticket,
  ListTree,
  LayoutTemplate,
  Timer,
  BookOpen,
  FolderKanban,
  Inbox,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ChangePasswordDialog from './ChangePasswordDialog';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}
interface NavGroup {
  label: string;
  color: string;
  items: NavItem[];
}
interface MyClient { name: string; logoUrl: string | null; }

const tenantNavGroups: NavGroup[] = [
  {
    label: 'Workspace',
    color: 'text-sky-400',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/tickets', label: 'Tickets', icon: Ticket },
      { to: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen },
      { to: '/projects', label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    label: 'Administration',
    color: 'text-amber-400',
    items: [
      { to: '/users', label: 'Users', icon: Users },
      { to: '/roles', label: 'Roles', icon: KeyRound },
      { to: '/admin/customer-companies', label: 'Customer Companies', icon: Building2 },
      { to: '/admin/templates', label: 'Templates', icon: LayoutTemplate },
      { to: '/admin/picklists', label: 'Picklist Options', icon: ListTree },
      { to: '/admin/sla', label: 'SLA Policies', icon: Timer },
      { to: '/admin/channels', label: 'Inbound Email', icon: Inbox },
    ],
  },
];

const superAdminNavGroups: NavGroup[] = [
  {
    label: 'Platform',
    color: 'text-sky-400',
    items: [
      { to: '/platform/clients', label: 'Clients', icon: Building2 },
      { to: '/platform/forms', label: 'Forms', icon: ClipboardList },
    ],
  },
  {
    label: 'Settings',
    color: 'text-amber-400',
    items: [{ to: '/platform/smtp-config', label: 'SMTP Config', icon: Mail }],
  },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const isSuperAdmin = !!user?.roles.includes('SuperAdmin');
  const isAdmin = !!user?.roles.includes('Admin');
  // External customer contacts get a restricted portal — just their tickets.
  const isCustomer = !!user?.roles.includes('Customer') && !isAdmin;
  const navGroups = isSuperAdmin
    ? superAdminNavGroups
    : tenantNavGroups
        // Administration is admin-only; regular users just get the Workspace group.
        .filter((group) => group.label !== 'Administration' || isAdmin)
        .map((group) => {
          if (group.label === 'Administration') {
            return { ...group, items: [...group.items, { to: '/organization', label: 'Organization', icon: Building2 }] };
          }
          // Customers only see Dashboard + Tickets, not internal KB/Projects.
          if (group.label === 'Workspace' && isCustomer) {
            return { ...group, items: group.items.filter((i) => i.to === '/dashboard' || i.to === '/tickets') };
          }
          return group;
        });

  const { data: myClient } = useQuery<MyClient | null>({
    queryKey: ['my-client'],
    queryFn: async () => (await api.get('/api/auth/me/client')).data,
    enabled: !isSuperAdmin,
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed top-0 left-0 flex h-screen flex-col overflow-y-auto bg-sidebar px-3 py-6 text-sidebar-foreground transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('mb-6 flex items-center gap-2 px-2', collapsed && 'justify-center px-0')}>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <LayoutDashboard className="size-4" />
          </div>
          {!collapsed && (
            <span className="truncate text-base font-bold tracking-wide text-sidebar-foreground">Enterprise App</span>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <div className={cn('mb-1 px-3 text-[10px] font-semibold tracking-wider uppercase', group.color)}>
                  {group.label}
                </div>
              )}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        collapsed && 'justify-center px-0',
                        isActive && 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? 'Sign Out' : undefined}
          className={cn(
            'mt-4 flex shrink-0 items-center gap-2.5 rounded-lg border border-sidebar-border px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && 'Sign Out'}
        </button>
      </aside>

      <main className={cn('flex min-h-screen flex-1 flex-col transition-[margin] duration-200', collapsed ? 'ml-16' : 'ml-60')}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>

          <div className="flex min-w-0 shrink-0 items-center gap-2 border-r pr-4">
            {isSuperAdmin ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="size-4" />
              </div>
            ) : myClient?.logoUrl ? (
              <img src={assetUrl(myClient.logoUrl)!} alt={myClient.name} className="size-8 shrink-0 rounded-lg border object-cover" />
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-4" />
              </div>
            )}
            <span className="max-w-[160px] truncate text-sm font-semibold text-foreground">
              {isSuperAdmin ? 'Platform Admin' : (myClient?.name ?? 'Enterprise App')}
            </span>
          </div>

          <div className="relative w-full max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="pl-8"
            />
          </div>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {user?.username?.slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden min-w-0 text-left sm:block">
                <div className="truncate text-sm font-medium text-foreground">{user?.username}</div>
                <div className="truncate text-xs text-muted-foreground">{user?.roles.join(', ')}</div>
              </div>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="truncate font-medium">{user?.username}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">{user?.roles.join(', ')}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
                <Lock className="size-4" />
                Change Password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                <LogOut className="size-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex-1 bg-muted/30 p-8">{children}</div>
      </main>

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  );
}
