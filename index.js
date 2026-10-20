require("dotenv").config()
const { Pool } = require("pg")
const { createHttpClient } = require("./src/infra/httpClient")
const { withCache, withConcurrencyLimit } = require("./src/infra/httpWrappers")
const { loadConfig } = require("./src/config")
const { createMoocClient } = require("./src/clients/moocClient")
const { createGithubClient } = require("./src/clients/githubClient")
const {
  createGithubAccountsClient,
} = require("./src/clients/githubAccountsClient")
const { createStatsClient } = require("./src/clients/statsClient")
const { createCourseService } = require("./src/services/courseService")
const { createInvitationService } = require("./src/services/invitationService")
const { createPullRequestService } = require("./src/services/pullRequestService")
const { createActionLog, noActionLog } = require("./src/infra/actionLog")
const { createApp } = require("./src/app")

const config = loadConfig()
const http = createHttpClient()

const db = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : null
// An idle connection dropped by the server must not crash the app
db?.on("error", (err) => console.error("Database:", err.message))
if (!db) console.log("DATABASE_URL not set, actions are not logged")

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
const accounts = createGithubAccountsClient({
  http,
  baseUrl: config.githubApiBase,
  credentials: config.githubCredentials,
})
const invitationService = createInvitationService({
  accounts,
  // The repository checks of an accepted invitation must not show the
  // cached "no access"
  onAccepted: github.forgetRepo,
})

const app = createApp({
  tabs: config.tabs,
  mooc,
  courseService,
  invitationService,
  // The approval must show up at once on the tab, not the cached reviews
  pullRequestService: createPullRequestService({
    accounts,
    onApproved: github.forgetRepo,
  }),
  stats: createStatsClient({ http }),
  actionLog: db ? createActionLog({ db }) : noActionLog,
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
    server.close(async () => {
      await db?.end().catch(() => {})
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
