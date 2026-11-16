export const REFRESH_COOKIE = "cmms_refresh";
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "content-length",
    Vary: "Origin",
  };
}

export function jsonResponse(req: Request, body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req), ...extra },
  });
}

export function refreshCookie(req: Request, token: string): string {
  const isLocal = (req.headers.get("Origin") ?? "").includes("localhost");
  const flags = isLocal
    ? "Path=/; HttpOnly; SameSite=Lax"
    : "Path=/; HttpOnly; SameSite=Lax; Secure";
  return `${REFRESH_COOKIE}=${token}; ${flags}; Max-Age=${REFRESH_MAX_AGE}`;
}

export function clearCookie(req: Request): string {
  const isLocal = (req.headers.get("Origin") ?? "").includes("localhost");
  const flags = isLocal
    ? "Path=/; HttpOnly; SameSite=Lax"
    : "Path=/; HttpOnly; SameSite=Lax; Secure";
  return `${REFRESH_COOKIE}=; ${flags}; Max-Age=0`;
}

export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === REFRESH_COOKIE) return rest.join("=") || null;
  }
  return null;
}
