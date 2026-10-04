const path = require("path")
const express = require("express")
const shibbolethCharsetMiddleware = require("unfuck-utf8-headers-middleware")
const { createPageRouter } = require("./routes/pages")
const { createApiRouter } = require("./routes/api")
const { requireAllowedUser } = require("./middleware/requireAllowedUser")
const { securityHeaders } = require("./middleware/securityHeaders")
const { requireSameOrigin } = require("./middleware/requireSameOrigin")

// Shibboleth sends header values as UTF-8 bytes but Node reads them as
// latin1, which garbles scandinavian letters (e.g. "ä" becomes "Ã¤")
const SHIBBOLETH_HEADERS = ["uid", "givenname", "sn", "mail", "hypersonstudentid"]

// basePath: path prefix the app is served under, e.g. "/mooc-grader" when
// the proxy forwards opetushallinto.cs.helsinki.fi/mooc-grader/... as is.
// "" serves it at the root.
function createApp({
  tabs,
  mooc,
  courseService,
  invitationService = null,
  auth,
  basePath = "",
}) {
  const app = express()
  app.disable("x-powered-by")

  const router = express.Router()
  router.use(securityHeaders)
  router.use(shibbolethCharsetMiddleware(SHIBBOLETH_HEADERS))
  router.use(requireAllowedUser(auth))
  router.use(requireSameOrigin)
  router.use(express.json())
  router.use("/static", express.static(path.join(__dirname, "..", "public")))
  router.use(createApiRouter({ tabs, mooc, invitationService }))
  router.use(createPageRouter({ tabs, courseService, invitationService, basePath }))

  app.use(basePath || "/", router)
  return app
}

module.exports = { createApp }
