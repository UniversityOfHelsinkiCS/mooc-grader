const fs = require("fs")
const { tabs } = require("./courses")
const { validateTabs } = require("./tabs")

function parseList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

// "/mooc-grader", "mooc-grader/" -> "/mooc-grader"; "" or "/" -> ""
function normalizeBasePath(value) {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "")
  if (trimmed === "") return ""
  if (!/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(trimmed)) {
    throw new Error(`Invalid BASE_PATH "${value}"`)
  }
  return `/${trimmed}`
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3033,
    // Path prefix the app is served under, e.g. BASE_PATH=/mooc-grader
    basePath: normalizeBasePath(env.BASE_PATH),
    moocApiBase: "https://courses.mooc.fi/api/v0/main-frontend",
    githubApiBase: "https://api.github.com",
    // Tried in order: the secondary is used when the primary is invalid,
    // rate limited or cannot see a repository
    githubCredentials: [
      { label: "primary", token: env.GITHUB_TOKEN },
      { label: "secondary", token: env.GITHUB_TOKEN_SECONDARY },
    ].filter((credential) => credential.token),
    // Repository checks are cached so that reloading the page is cheap
    githubCacheTtlMs: 5 * 60 * 1000,
    githubConcurrency: 8,
    cookie: fs.readFileSync(env.COOKIE_FILE || "cookie", "utf8").trim(),
    pageLimit: 50,
    tabs: validateTabs(tabs),
    auth: {
      // Comma separated, e.g. ALLOWED_UIDS=alice,bob. Unset means nobody.
      allowedUids: parseList(env.ALLOWED_UIDS),
      // Only local development runs without Shibboleth
      enforce: env.NODE_ENV !== "development",
    },
  }
}

module.exports = { loadConfig, normalizeBasePath }
