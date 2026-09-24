// Shibboleth puts the authenticated user's username in the uid header.
// Every request, static files included, is rejected unless it comes from
// an allowed user.
function requireAllowedUser({ allowedUids, enforce = true }) {
  const allowed = new Set(allowedUids)

  return (req, res, next) => {
    if (!enforce) {
      return next()
    }

    const uid = req.headers.uid
    if (!uid || !allowed.has(uid)) {
      console.warn(`Access denied for uid ${uid ? `"${uid}"` : "(missing)"}`)
      return res.status(403).send("Go home")
    }

    req.uid = uid
    return next()
  }
}

module.exports = { requireAllowedUser }
