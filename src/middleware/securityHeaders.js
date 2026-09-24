// Pages only load scripts and styles from /static, so everything else can be
// denied. frame-ancestors / X-Frame-Options stop other sites from framing
// the grading buttons (clickjacking).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  })
  // Pages and API responses contain student names, emails and grades, so
  // browsers and proxies must not store them; static files may be cached
  if (!req.path.startsWith("/static/")) {
    res.set("Cache-Control", "no-store")
  }
  next()
}

module.exports = { securityHeaders, CONTENT_SECURITY_POLICY }
