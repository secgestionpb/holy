import { LoginForm } from '@/components/landing/login-form'
import { ModuleIndex } from '@/components/landing/module-index'
import { OtTicket } from '@/components/landing/ot-ticket'
import { ThemeToggle } from '@/components/landing/theme-toggle'
import { Wordmark } from '@/components/landing/wordmark'

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <section className="blueprint grid min-h-dvh grid-cols-1 [grid-template-areas:'head'_'login'_'ticket'] lg:grid-cols-[1.08fr_0.92fr] lg:[grid-template-areas:'head_login'_'ticket_login']">
        <header className="[grid-area:head] px-6 pt-6 sm:px-10 lg:px-14 lg:pt-10">
          <div className="flex items-center justify-between">
            <Wordmark className="text-panel-foreground" />
            <ThemeToggle />
          </div>
          <div className="mt-12 max-w-xl lg:mt-16">
            <h1 className="font-heading text-[clamp(2.1rem,4.6vw,3.4rem)] leading-[1.04] font-extrabold tracking-[-0.02em] text-panel-foreground">
              El mantenimiento que el huésped nunca ve.
            </h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-panel-foreground/60">
              Activos, órdenes de trabajo, preventivos, inventario y cumplimiento del hotel,
              reunidos en un solo sistema.
            </p>
          </div>
        </header>

        <div className="[grid-area:login] flex items-center justify-center border-y border-panel-border bg-background px-6 py-12 sm:px-10 lg:border-y-0 lg:border-l lg:py-0">
          <div className="w-full max-w-[360px]">
            <h2 className="font-heading text-[26px] font-bold tracking-tight">Iniciar sesión</h2>
            <div className="mt-6">
              <LoginForm />
            </div>
            <p className="mt-6 text-[13px] leading-relaxed text-muted-foreground">
              ¿Sin acceso? El Administrador del sistema crea las cuentas y restablece las
              contraseñas.
            </p>
          </div>
        </div>

        <div className="[grid-area:ticket] flex items-end px-6 pt-8 pb-10 sm:px-10 lg:px-14 lg:pb-16">
          <OtTicket />
        </div>
      </section>

      <ModuleIndex />

      <footer className="border-t border-border bg-background px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark compact className="text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            Sistema de gestión de mantenimiento para uso interno del hotel.
          </p>
        </div>
      </footer>
    </div>
  )
}
