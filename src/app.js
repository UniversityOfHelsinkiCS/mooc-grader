const path = require("path")
const express = require("express")
const { createPageRouter } = require("./routes/pages")
const { createApiRouter } = require("./routes/api")
const { requireAllowedUser } = require("./middleware/requireAllowedUser")
const { securityHeaders } = require("./middleware/securityHeaders")
const { requireSameOrigin } = require("./middleware/requireSameOrigin")

function createApp({ tabs, mooc, courseService, auth }) {
  const app = express()
  app.disable("x-powered-by")
  app.use(securityHeaders)
  app.use(requireAllowedUser(auth))
  app.use(requireSameOrigin)
  app.use(express.json())
  app.use("/static", express.static(path.join(__dirname, "..", "public")))
  app.use(createApiRouter({ tabs, mooc }))
  app.use(createPageRouter({ tabs, courseService }))
  return app
}

module.exports = { createApp }
