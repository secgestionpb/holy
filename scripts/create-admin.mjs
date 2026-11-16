import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env.local')
const env = {}
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

const SUPABASE_URL = env.SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const [email, fullName, password] = process.argv.slice(2)
if (!email || !fullName || !password) {
  console.error('Uso: node scripts/create-admin.mjs <correo> "<nombre completo>" "<contraseña temporal>"')
  process.exit(1)
}

const headers = {
  'Content-Type': 'application/json',
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
}

const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password, email_confirm: true }),
})
if (!authRes.ok) {
  console.error('auth.admin create falló:', authRes.status, await authRes.text())
  process.exit(1)
}
const authUser = await authRes.json()

const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify({
    id: authUser.id,
    full_name: fullName,
    email: authUser.email,
    is_active: true,
    must_change_password: true,
  }),
})
if (!profileRes.ok) {
  console.error('insert users falló:', profileRes.status, await profileRes.text())
  process.exit(1)
}

const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/user_roles`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ user_id: authUser.id, role: 'administrador' }),
})
if (!roleRes.ok) {
  console.error('insert user_roles falló:', roleRes.status, await roleRes.text())
  process.exit(1)
}

console.log(`Admin creado: ${authUser.email} (${authUser.id})`)
console.log('  - must_change_password = true')
console.log('  - rol = administrador')
