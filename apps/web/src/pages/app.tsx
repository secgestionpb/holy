import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { ThemeToggle } from '@/components/landing/theme-toggle'
import { Wordmark } from '@/components/landing/wordmark'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fetchActiveCount } from '@/lib/admin-users'
import { logout } from '@/lib/auth'
import { isAdmin, useAuth } from '@/lib/auth-store'
import { fetchPendingDamageCount } from '@/lib/m2'

function navLinkClass(isActive: boolean): string {
  return [
    'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13.5px] font-medium transition-colors',
    isActive
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  ].join(' ')
}

type NavItemDef = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  show?: boolean
  badge?: ReactNode
}

type NavGroupDef = {
  id: string
  label: string
  icon: LucideIcon
  show?: boolean
  items: NavItemDef[]
}

function isItemActive(pathname: string, item: NavItemDef): boolean {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function isGroupActive(pathname: string, items: NavItemDef[]): boolean {
  return items.some((item) => isItemActive(pathname, item))
}

function NavGroupMenu({
  group,
  pathname,
}: {
  group: NavGroupDef
  pathname: string
}) {
  const active = isGroupActive(pathname, group.items)
  const GroupIcon = group.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Menú ${group.label}`}
          className={`${navLinkClass(active)} data-[state=open]:bg-muted`}
        >
          <GroupIcon className="size-4" />
          {group.label}
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {group.items.map((item) => {
          const ItemIcon = item.icon
          return (
            <DropdownMenuItem key={item.to} asChild>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex w-full items-center gap-2 ${isActive ? 'bg-muted text-foreground' : ''}`
                }
              >
                <ItemIcon className="size-4" />
                <span className="truncate">{item.label}</span>
                {item.badge}
              </NavLink>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function AppLayout() {
  const user = useAuth((s) => s.user)
  const roles = useAuth((s) => s.roles)
  const navigate = useNavigate()
  const location = useLocation()
  const admin = isAdmin(roles)
  const maintenance = roles.includes('mantenimiento')
  const technicianOnly = roles.length > 0 && roles.every((role) => role === 'tecnico')
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [pendingReports, setPendingReports] = useState<number | null>(null)

  useEffect(() => {
    if (!admin) return
    let alive = true
    void fetchActiveCount().then((count) => {
      if (alive) setActiveCount(count)
    })
    return () => {
      alive = false
    }
  }, [admin])

  useEffect(() => {
    if (!maintenance) return
    let alive = true
    void fetchPendingDamageCount().then((count) => {
      if (alive) setPendingReports(count)
    })
    return () => {
      alive = false
    }
  }, [maintenance])

  function refreshPendingReports() {
    if (!maintenance) return
    void fetchPendingDamageCount().then(setPendingReports)
  }

  async function onLogout() {
    await logout()
    navigate('/', { replace: true })
  }

  const allGroups: NavGroupDef[] = [
    {
      id: 'operacion',
      label: 'Operación',
      icon: ClipboardList,
      items: [
        { to: '/app/ordenes', label: 'Órdenes de Trabajo', icon: ClipboardList },
        {
          to: '/app/reportes-dano',
          label: 'Reportes de Daño',
          icon: TriangleAlert,
          badge: maintenance && pendingReports !== null && pendingReports > 0 ? (
            <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-[11.5px] font-semibold text-amber-700 dark:text-amber-400">
              {pendingReports}
            </span>
          ) : undefined,
        },
        { to: '/app/preventivo', label: 'Preventivo', icon: CalendarDays },
      ],
    },
    {
      id: 'recursos',
      label: 'Recursos',
      icon: Boxes,
      items: [
        { to: '/app/activos', label: 'Activos', icon: Boxes },
        { to: '/app/inventario', label: 'Inventario', icon: Warehouse },
        { to: '/app/proveedores', label: 'Proveedores', icon: Truck, show: !technicianOnly },
      ],
    },
    {
      id: 'gestion',
      label: 'Gestión',
      icon: BarChart3,
      items: [
        { to: '/app/reportes', label: 'Reportes', icon: BarChart3 },
        { to: '/app/cumplimiento', label: 'Cumplimiento', icon: ShieldCheck, show: !technicianOnly },
      ],
    },
    {
      id: 'admin',
      label: 'Administración',
      icon: Settings,
      show: admin,
      items: [
        {
          to: '/app/usuarios',
          label: 'Usuarios',
          icon: Users,
          badge: activeCount !== null ? (
            <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-semibold text-primary">
              {activeCount}
            </span>
          ) : undefined,
        },
        { to: '/app/configuracion', label: 'Configuración', icon: Settings },
        { to: '/app/auditoria', label: 'Auditoría', icon: ScrollText },
      ],
    },
  ]

  const visibleGroups = allGroups
    .filter((group) => group.show !== false)
    .map((group) => ({ ...group, items: group.items.filter((item) => item.show !== false) }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <div className="flex items-center gap-6">
            <Wordmark compact className="text-foreground" />
            <nav className="hidden items-center gap-1 sm:flex">
              <NavLink to="/app" end className={({ isActive }) => navLinkClass(isActive)}>
                <LayoutDashboard className="size-4" />
                Panel
              </NavLink>
              {visibleGroups.map((group) => (
                <NavGroupMenu key={group.id} group={group} pathname={location.pathname} />
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[24ch] truncate text-[13px] text-muted-foreground sm:block">
              {user?.email}
            </span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut />
              Salir
            </Button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 sm:hidden">
          <NavLink to="/app" end className={({ isActive }) => navLinkClass(isActive)}>
            <LayoutDashboard className="size-4" />
            Panel
          </NavLink>
          {visibleGroups.map((group) => (
            <NavGroupMenu key={group.id} group={group} pathname={location.pathname} />
          ))}
        </nav>
      </header>

      <Outlet
        context={{
          refreshActiveCount: () => void fetchActiveCount().then(setActiveCount),
          refreshPendingReports,
        }}
      />
    </div>
  )
}
