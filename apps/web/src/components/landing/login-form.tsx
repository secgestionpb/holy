import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login } from '@/lib/auth'

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Escribe tu correo.')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Escribe un correo válido.'),
  password: z.string().min(1, 'Escribe tu contraseña.'),
})

type FormValues = z.infer<typeof schema>

export function LoginForm() {
  const [reveal, setReveal] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const result = await login(values.email, values.password)
    if (result.ok) {
      navigate(result.mustChangePassword ? '/cambio-clave' : '/app', { replace: true })
      return
    }
    setServerError(result.error.message)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Correo</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="nombre@hotel.com"
          aria-invalid={errors.email ? true : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p role="alert" className="text-[13px] text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={errors.password ? true : undefined}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            aria-label={reveal ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute top-0 right-0 flex size-9 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md"
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
            Entrando
          </>
        ) : (
          'Entrar'
        )}
      </Button>
    </form>
  )
}
