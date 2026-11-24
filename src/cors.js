export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.includes(String(origin).trim().replace(/\/+$/, "").toLowerCase());
}

export function corsHeaders(origin, cfg) {
  if (!isAllowedOrigin(origin, cfg.allowedOrigins)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
