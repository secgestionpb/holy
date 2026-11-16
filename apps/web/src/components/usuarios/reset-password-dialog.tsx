import { useState } from 'react'
import { Copy, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { resetPassword, type AdminUserRow } from '@/lib/admin-users'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUserRow | null
  onSaved: () => void
}

export function ResetPasswordDialog({ open, onOpenChange, user, onSaved }: Props) {
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setRevealedPassword(null)
      setServerError(null)
      setSubmitting(false)
    }
    onOpenChange(next)
  }

  async function copyPassword() {
    if (!revealedPassword) return
    try {
      await navigator.clipboard.writeText(revealedPassword)
      toast.success('Contraseña copiada al portapapeles.')
    } catch {
      toast.error('No se pudo copiar. Selecciona la contraseña manualmente.')
    }
  }

  async function confirmReset() {
    if (!user) return
    setSubmitting(true)
    setServerError(null)
    const result = await resetPassword(user.id)
    setSubmitting(false)
    if (result.ok) {
      setRevealedPassword(result.temp_password)
      onSaved()
      return
    }
    setServerError(result.message)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restablecer contraseña</DialogTitle>
          <DialogDescription>
            {revealedPassword
              ? `Contraseña restablecida para ${user?.full_name}.`
              : user
                ? `Se restablecerá la contraseña de ${user.full_name}.`
                : ''}
          </DialogDescription>
        </DialogHeader>

        {revealedPassword ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-border bg-muted/50 px-3.5 py-2.5 text-[13px] leading-snug text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Transmítela al usuario por un canal externo; deberá cambiarla en su primer
                inicio de sesión.
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2.5">
              <code className="font-mono text-[15px] font-semibold tracking-wide select-all">
                {revealedPassword}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyPassword()}>
                <Copy />
                Copiar
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] leading-snug text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Se aplicará la contraseña predeterminada del sistema y quedará visible en el
                paso siguiente. Transmítela al usuario por un canal externo; se le pedirá
                cambiarla en su primer inicio de sesión.
              </span>
            </div>

            {serverError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
              >
                {serverError}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={() => void confirmReset()} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Confirmando
                  </>
                ) : (
                  'Confirmar restablecimiento'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
