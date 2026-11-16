export const PASSWORD_POLICY =
  'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.'

export function passwordPolicyError(password: string): string | null {
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return PASSWORD_POLICY
  }
  return null
}
