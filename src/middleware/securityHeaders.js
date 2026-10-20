const { SESSION_GUARD_HASH } = require("../views/sessionGuard")

// Pages only load scripts and styles from /static, plus the one inline
// session guard script allowed by its hash, so everything else can be
// denied. frame-ancestors / X-Frame-Options stop other sites from framing
// the grading buttons (clickjacking).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' '${SESSION_GUARD_HASH}'`,
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
