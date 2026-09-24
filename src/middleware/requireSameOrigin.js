const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

// Browsers set Sec-Fetch-Site on every request; older ones only send Origin.
// Requests with neither come from non-browser clients, which do not carry
// the user's Shibboleth session.
function isCrossOrigin(req) {
  const fetchSite = req.get("sec-fetch-site")
  if (fetchSite) {
    return fetchSite !== "same-origin"
  }

  const origin = req.get("origin")
  if (!origin) {
    return false
  }
  try {
    const host = req.get("x-forwarded-host") ?? req.get("host")
    return new URL(origin).host !== host
  } catch {
    // e.g. "Origin: null" from sandboxed pages
    return true
  }
}

// A link or bookmark that opens a page in the browser window. Anything else
// coming from another site (images, scripts, iframes, fetch) is not a
// legitimate use of the grader, and would make it do its slow and
// rate-limited mooc.fi and GitHub calls on the user's behalf.
function isTopLevelNavigation(req) {
  return (
    req.get("sec-fetch-mode") === "navigate" &&
    req.get("sec-fetch-dest") === "document"
  )
}

function isCrossSiteSubresource(req) {
  const fetchSite = req.get("sec-fetch-site")
  return (
    (fetchSite === "cross-site" || fetchSite === "same-site") &&
    !isTopLevelNavigation(req)
  )
}

// Cross-site protection:
// - reads (GET) from other sites are allowed only as top-level navigations
// - state-changing requests (CSRF) must come from the app's own pages and
//   carry JSON, which a cross-site form cannot send
function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    if (isCrossSiteSubresource(req)) {
      console.warn(`Cross-site ${req.get("sec-fetch-dest")} request to ${req.path} rejected`)
      return res.status(403).send("Forbidden")
    }
    return next()
  }

  if (isCrossOrigin(req)) {
    console.warn(`Cross-origin ${req.method} ${req.path} rejected`)
    return res.status(403).json({ error: "Cross-origin request rejected" })
  }

  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" })
  }

  return next()
}

module.exports = { requireSameOrigin }
