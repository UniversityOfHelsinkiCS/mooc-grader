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

// Statuses after which a request is retried with the next token: the token
// is invalid (401), rate limited or blocked (403, 429), or its account cannot
// see the repository (404), e.g. when a student invited only the other account
const RETRY_WITH_NEXT_TOKEN = new Set([401, 403, 404, 429])

// credentials: [{ label, token }], tried in this order
function createGithubClient({ http, baseUrl, credentials = [] }) {
  const headers = {
    "User-Agent": "crawler",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const states = credentials.map(({ label, token }) => ({
    label,
    token,
    rejected: false,
  }))

  // Tries each token in turn. A token GitHub rejects (401) is not used again
  // until restart. With no usable token the request is sent without one,
  // which works for public repositories at 60 requests per hour.
  async function githubGet(url) {
    const usable = states.filter((credential) => !credential.rejected)
    if (usable.length === 0) {
      return http.get(url, headers)
    }

    let response
    for (const credential of usable) {
      response = await http.get(url, {
        ...headers,
        Authorization: `Bearer ${credential.token}`,
      })
      if (response.status === 401 && !credential.rejected) {
        credential.rejected = true
        console.error(
          `GitHub ${credential.label} token was rejected (401); it is not used until restart`,
        )
      }
      if (!RETRY_WITH_NEXT_TOKEN.has(response.status)) {
        return response
      }
    }
    return response
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
      const { status, body } = await githubGet(
        `${baseUrl}/repos/${owner}/${repo}/actions/runs?per_page=30`,
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
      const { status } = await githubGet(`${baseUrl}/repos/${owner}/${repo}`)
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
      const { status, body } = await githubGet(readmeUrl(parsed))
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
