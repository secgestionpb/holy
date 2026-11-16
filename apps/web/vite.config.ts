import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import path from 'node:path'

// Cloudflare (Supabase hosted) envía Set-Cookie __cf_bm con Domain=.supabase.co.
// Al pasar por el proxy, ese dominio no coincide con el origen local y el
// navegador rechaza la cookie ("dominio no válido"). Es solo bot-management:
// se filtra en las respuestas del proxy para no ensuciar la consola.
const CLOUDFLARE_COOKIES = /^(__cf_bm|cf_clearance|__cflb)=/i

function stripCloudflareCookies(): ProxyOptions {
  return {
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyRes', (proxyRes) => {
        const cookies = proxyRes.headers['set-cookie']
        if (!cookies || cookies.length === 0) return
        const filtered = cookies.filter((cookie) => !CLOUDFLARE_COOKIES.test(cookie))
        if (filtered.length === 0) delete proxyRes.headers['set-cookie']
        else proxyRes.headers['set-cookie'] = filtered
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const supabaseUrl = env.VITE_SUPABASE_URL

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: true,
      allowedHosts: true,
      ...(supabaseUrl
        ? {
            proxy: {
              '/functions/v1': { target: supabaseUrl, ...stripCloudflareCookies() },
              '/rest/v1': { target: supabaseUrl, ...stripCloudflareCookies() },
              '/auth/v1': { target: supabaseUrl, ...stripCloudflareCookies() },
              '/storage/v1': { target: supabaseUrl, ...stripCloudflareCookies() },
            },
          }
        : {}),
    },
  }
})
