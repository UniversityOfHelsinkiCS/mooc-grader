const fs = require("fs")
const { tabs } = require("./courses")
const { validateTabs } = require("./tabs")

function parseList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3033,
    moocApiBase: "https://courses.mooc.fi/api/v0/main-frontend",
    githubApiBase: "https://api.github.com",
    githubToken: env.GITHUB_TOKEN,
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

module.exports = { loadConfig }
