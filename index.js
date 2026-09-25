require("dotenv").config()
const { createHttpClient } = require("./src/infra/httpClient")
const { withCache, withConcurrencyLimit } = require("./src/infra/httpWrappers")
const { loadConfig } = require("./src/config")
const { createMoocClient } = require("./src/clients/moocClient")
const { createGithubClient } = require("./src/clients/githubClient")
const {
  createGithubAccountsClient,
} = require("./src/clients/githubAccountsClient")
const { createCourseService } = require("./src/services/courseService")
const { createInvitationService } = require("./src/services/invitationService")
const { createApp } = require("./src/app")

const config = loadConfig()
const http = createHttpClient()

const mooc = createMoocClient({
  http,
  baseUrl: config.moocApiBase,
  cookie: config.cookie,
  pageLimit: config.pageLimit,
})
const github = createGithubClient({
  http: withCache(withConcurrencyLimit(http, config.githubConcurrency), {
    ttlMs: config.githubCacheTtlMs,
  }),
  baseUrl: config.githubApiBase,
  credentials: config.githubCredentials,
})
const courseService = createCourseService({ mooc, github })
// Invitations are not cached: accepting one must show up at once
const invitationService = createInvitationService({
  accounts: createGithubAccountsClient({
    http,
    baseUrl: config.githubApiBase,
    credentials: config.githubCredentials,
  }),
})

const app = createApp({
  tabs: config.tabs,
  mooc,
  courseService,
  invitationService,
  auth: config.auth,
  basePath: config.basePath,
})

const server = app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}${config.basePath}/`)
})

// Node running as PID 1 in a container has no default signal handlers, so
// without these a stop (e.g. a Kubernetes rollout) waits for a forced kill.
// Requests in progress are finished before exiting.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
