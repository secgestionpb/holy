import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, KeyRound, Loader2, LogOut } from 'lucide-react'
import { Wordmark } from '@/components/landing/wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeOwnPassword } from '@/lib/admin-users'
import { login, logout } from '@/lib/auth'
import { useAuth } from '@/lib/auth-store'
import { PASSWORD_POLICY, passwordPolicyError } from '@/lib/password'

const schema = z
  .object({
    password: z
      .string()
      .min(1, 'Escribe la nueva contraseña.')
      .refine((value) => passwordPolicyError(value) === null, PASSWORD_POLICY),
    confirm: z.string().min(1, 'Repite la nueva contraseña.'),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirm'],
  })

type FormValues = z.infer<typeof schema>

export default function ChangePassword() {
  const user = useAuth((s) => s.user)
  const patchUser = useAuth((s) => s.patchUser)
  const navigate = useNavigate()
  const [reveal, setReveal] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const result = await changeOwnPassword(values.password)
    if (result.ok) {
      patchUser({ must_change_password: false })
      // GoTrue revoca los refresh tokens al cambiar la clave: renovamos la
      // sesión con la clave nueva para que la app siga viva tras recargar.
      await login(user?.email ?? '', values.password).catch(() => undefined)
      navigate('/app', { replace: true })
      return
    }
    setServerError(result.message)
  }

  async function onLogout() {
    await logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="blueprint flex min-h-dvh flex-col">
      <header className="px-6 pt-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Wordmark className="text-panel-foreground" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="text-panel-foreground hover:bg-white/10 hover:text-panel-foreground"
          >
            <LogOut />
            Salir
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] rounded-lg border border-panel-border bg-background p-8">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
          <h1 className="font-heading mt-5 text-[24px] font-bold tracking-tight">
            Cambiar contraseña
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Tu contraseña es temporal. Crea una nueva para continuar.
          </p>
          <p className="mt-4 text-[13px] text-muted-foreground">Conectado como {user?.email}</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password">Nueva contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="pr-10"
                  aria-invalid={errors.password ? true : undefined}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setReveal((value) => !value)}
                  aria-label={reveal ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute top-0 right-0 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Repetir nueva contraseña</Label>
              <Input
                id="confirm"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={errors.confirm ? true : undefined}
                {...register('confirm')}
              />
              {errors.confirm && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.confirm.message}
                </p>
              )}
            </div>

            <p className="text-[12.5px] leading-snug text-muted-foreground">{PASSWORD_POLICY}</p>

            {serverError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
              >
                {serverError}
              </div>
            )}

            <Button type="submit" size="lg" className="h-11 w-full text-[15px]" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Guardando
                </>
              ) : (
                'Guardar contraseña'
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
