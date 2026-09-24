require("dotenv").config()
const { createHttpClient } = require("./src/infra/httpClient")
const { withCache, withConcurrencyLimit } = require("./src/infra/httpWrappers")
const { loadConfig } = require("./src/config")
const { createMoocClient } = require("./src/clients/moocClient")
const { createGithubClient } = require("./src/clients/githubClient")
const { createCourseService } = require("./src/services/courseService")
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
  token: config.githubToken,
})
const courseService = createCourseService({ mooc, github })

const app = createApp({
  tabs: config.tabs,
  mooc,
  courseService,
  auth: config.auth,
})

const server = app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`)
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
