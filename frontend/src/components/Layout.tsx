import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import NotificationBell from './NotificationBell';
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
  ShieldCheck,
  Lock,
  Ticket,
  ListTree,
  IdCard,
  HardDrive,
  LayoutTemplate,
  Timer,
  BookOpen,
  FolderKanban,
  Inbox,
  Wallet,
  Clock3,
  GitPullRequestArrow,
  Boxes,
  PackagePlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePrefs } from '../context/PreferencesContext';
import api from '../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ChangePasswordDialog from './ChangePasswordDialog';
import PreferencesMenu from './PreferencesMenu';
import GlobalSearch from './GlobalSearch';
import CopilotWidget from './CopilotWidget';

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
      { to: '/change-requests', label: 'Change Management', icon: GitPullRequestArrow },
      { to: '/timesheet', label: 'Timesheet', icon: Clock3 },
      { to: '/client-visits', label: 'Client Visits', icon: ClipboardList },
    ],
  },
  {
    label: 'Administration',
    color: 'text-amber-400',
    items: [
      { to: '/users', label: 'Users', icon: Users },
      { to: '/roles', label: 'Roles', icon: KeyRound },
      { to: '/admin/customer-companies', label: 'Clients', icon: Building2 },
      { to: '/admin/products', label: 'Products', icon: Boxes },
      { to: '/admin/product-requests', label: 'Product Requests', icon: PackagePlus },
      { to: '/admin/templates', label: 'Templates', icon: LayoutTemplate },
      { to: '/admin/project-templates', label: 'Project Templates', icon: FolderKanban },
      // One registry for every dropdown list — ticketing picklists and the
      // Change Management lists were merged into this single screen.
      { to: '/admin/options', label: 'Option List', icon: ListTree },
      { to: '/admin/sla', label: 'SLA Policies', icon: Timer },
      { to: '/admin/channels', label: 'Inbound Email', icon: Inbox },
      { to: '/admin/resource-costs', label: 'Resource Costs', icon: Wallet },
      { to: '/admin/employees', label: 'Employee Master', icon: IdCard },
      { to: '/admin/assets', label: 'Asset Master', icon: HardDrive },
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

// One nav item, shared by the sidebar and the top bar so both layouts stay in
// step with navGroups (and both pick up the accent via --sidebar-primary).
function NavItemLink({ item, collapsed, horizontal }: { item: NavItem; collapsed?: boolean; horizontal?: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={collapsed && !horizontal ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          horizontal ? 'shrink-0 whitespace-nowrap px-3 py-1.5' : 'px-3 py-2',
          !horizontal && collapsed && 'justify-center px-0',
          isActive && 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary',
        )
      }
    >
      <item.icon className="size-4 shrink-0" />
      {(horizontal || !collapsed) && item.label}
    </NavLink>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { prefs } = usePrefs();
  const [collapsedState, setCollapsed] = useState(false);
  // 'lite' is the icon-only rail, so it pins the same `collapsed` state the
  // header toggle drives; 'topbar' drops the aside entirely.
  const sidebarHidden = prefs.nav === 'topbar';
  const collapsed = prefs.nav === 'lite' || collapsedState;
  // The sidebar is fixed, and portalled overlays land on <body> outside <main>.
  // Publishing its width lets a full-screen overlay stay inside the content area
  // instead of covering the nav (see the CR Workflow dialog).
  const contentLeft = sidebarHidden ? '0px' : collapsed ? '4rem' : '15rem';
  useEffect(() => {
    document.documentElement.style.setProperty('--app-content-left', contentLeft);
  }, [contentLeft]);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const isSuperAdmin = !!user?.roles.includes('SuperAdmin');
  const isAdmin = !!user?.roles.includes('Admin');
  const isCustomerAdmin = !!user?.roles.includes('CustomerAdmin');
  // Customer side = a company's own admin + its employees. Restricted portal.
  const isCustomer = (!!user?.roles.includes('Customer') || isCustomerAdmin) && !isAdmin;
  const navGroups = isSuperAdmin
    ? superAdminNavGroups
    : (() => {
        const groups = tenantNavGroups
          // Administration is admin-only; regular users just get the Workspace group.
          .filter((group) => group.label !== 'Administration' || isAdmin)
          .map((group) => {
            if (group.label === 'Administration') {
              return {
                ...group,
                items: [
                  ...group.items,
                  { to: '/organization', label: 'Organization', icon: Building2 },
                  { to: '/admin/smtp-config', label: 'Email Settings', icon: Mail },
                ],
              };
            }
            // Customers see Dashboard, Tickets, and the Knowledge Base (self-service) — not Projects.
            // A customer company admin also gets a Team screen to manage their own people.
            if (group.label === 'Workspace' && isCustomer) {
              const allowed = ['/dashboard', '/tickets', '/knowledge-base'];
              const items = group.items.filter((i) => allowed.includes(i.to));
              if (isCustomerAdmin) {
                items.push({ to: '/my-products', label: 'Products', icon: Boxes });
                items.push({ to: '/my-change-requests', label: 'Change Management', icon: GitPullRequestArrow });
                items.push({ to: '/my-team', label: 'Team', icon: Users });
              }
              return { ...group, items };
            }
            // Agents keep Client Visits: the API gives them their own assigned
            // visits so they can report hours and status back. They also get
            // Clients, read-only — a consultant named as an excess-hours approver
            // decides those requests on the client's product screen, so the page
            // has to be reachable from their login.
            if (group.label === 'Workspace' && !isAdmin && !isCustomer) {
              return {
                ...group,
                items: [...group.items, { to: '/admin/customer-companies', label: 'Clients', icon: Building2 }],
              };
            }
            return group;
          });
        // Agents (non-admin, non-customer) get Email Settings via a small Settings group.
        if (!isAdmin && !isCustomer) {
          groups.push({ label: 'Settings', color: 'text-amber-400', items: [{ to: '/admin/smtp-config', label: 'Email Settings', icon: Mail }] });
        }
        return groups;
      })();

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
      {!sidebarHidden && (
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
                    <NavItemLink key={item.to} item={item} collapsed={collapsed} />
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
      )}

      <main
        className={cn(
          'flex min-h-screen min-w-0 flex-1 flex-col transition-[margin] duration-200',
          sidebarHidden ? 'ml-0' : collapsed ? 'ml-16' : 'ml-60',
        )}
      >
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
          {prefs.nav === 'sidebar' && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          )}

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

          <GlobalSearch />

          <div className="flex-1" />

          <NotificationBell />

          <DropdownMenu modal={false}>
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
            <DropdownMenuContent align="end" className="max-h-[80vh] w-72 overflow-y-auto">
              <PreferencesMenu />
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setChangePasswordOpen(true)}>
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

        {sidebarHidden && (
          <nav className="sticky top-14 z-10 flex shrink-0 items-center gap-1 overflow-x-auto bg-sidebar px-4 py-2 text-sidebar-foreground">
            {navGroups.flatMap((group) =>
              group.items.map((item) => <NavItemLink key={`${group.label}-${item.to}`} item={item} horizontal />),
            )}
          </nav>
        )}

        <div className="min-w-0 flex-1 bg-muted/30 p-8">{children}</div>
      </main>

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
      {!isSuperAdmin && <CopilotWidget />}
    </div>
  );
}
