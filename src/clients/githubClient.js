const { parseGitHubRepo, selectRelevantRun } = require("../domain/repository")

// Only the start of a very large README is checked
const MAX_README_LENGTH = 100_000

// GitHub answers 429, or 403 with a "rate limit" message for both primary
// and secondary limits
function isRateLimited(status, body) {
  return (
    status === 429 ||
    (status === 403 && /rate limit/i.test(body?.message ?? ""))
  )
}

function createGithubClient({ http, baseUrl, token }) {
  const headers = {
    "User-Agent": "crawler",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  function readmeUrl({ owner, repo, dir }) {
    return dir
      ? `${baseUrl}/repos/${owner}/${repo}/readme/${dir}`
      : `${baseUrl}/repos/${owner}/${repo}/readme`
  }

  // Returns { conclusion, branch, repoExists } of the latest relevant
  // workflow run, or null when the URL is not a GitHub repository.
  // repoExists comes for free here, so GHA courses need no separate check.
  async function getGhaStatus(repoUrl) {
    const parsed = parseGitHubRepo(repoUrl)
    if (!parsed) return null
    const { owner, repo } = parsed
    try {
      const { status, body } = await http.get(
        `${baseUrl}/repos/${owner}/${repo}/actions/runs?per_page=30`,
        headers,
      )

      if (isRateLimited(status, body)) {
        console.error(`Rate limit exceeded for ${owner}/${repo}`)
        return { conclusion: "rate limited", branch: null, repoExists: null }
      }

      if (status === 404) {
        return { conclusion: "not found", branch: null, repoExists: false }
      }

      if (status !== 200) {
        console.error(
          `API error ${status} for ${owner}/${repo}:`,
          body.message || body,
        )
        return { conclusion: "error", branch: null, repoExists: null }
      }

      const run = selectRelevantRun(body.workflow_runs ?? [])
      if (!run) {
        return { conclusion: "no runs", branch: null, repoExists: true }
      }

      return {
        conclusion: run.conclusion ?? run.status,
        branch: run.head_branch,
        repoExists: true,
      }
    } catch (error) {
      console.error(`GHA error for ${owner}/${repo}:`, error.message)
      return { conclusion: "error", branch: null, repoExists: null }
    }
  }

  // true / false, or null when it could not be determined
  async function repoExists(repoUrl) {
    const parsed = parseGitHubRepo(repoUrl)
    if (!parsed) return null
    const { owner, repo } = parsed
    try {
      const { status } = await http.get(
        `${baseUrl}/repos/${owner}/${repo}`,
        headers,
      )
      if (status === 404) return false
      if (status === 200) return true
      console.error(
        `Repo existence check API error ${status} for ${owner}/${repo}`,
      )
      return null
    } catch (error) {
      console.error(
        `Repo existence check error for ${owner}/${repo}:`,
        error.message,
      )
      return null
    }
  }

  // Returns { found: true, text }, { found: false } when there is no README,
  // or null when the README could not be fetched
  async function getReadme(repoUrl) {
    const parsed = parseGitHubRepo(repoUrl)
    if (!parsed) return null
    const { owner, repo } = parsed
    try {
      const { status, body } = await http.get(readmeUrl(parsed), headers)
      if (status === 404) return { found: false }
      if (status !== 200 || !body || !body.content) {
        console.error(`README API error ${status} for ${owner}/${repo}`)
        return null
      }
      return {
        found: true,
        text: Buffer.from(body.content, "base64")
          .toString("utf8")
          .slice(0, MAX_README_LENGTH),
      }
    } catch (error) {
      console.error(`README error for ${owner}/${repo}:`, error.message)
      return null
    }
  }

  return { getGhaStatus, repoExists, getReadme }
}

module.exports = { createGithubClient, MAX_README_LENGTH }
