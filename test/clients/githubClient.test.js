const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  createGithubClient,
  MAX_README_LENGTH,
} = require("../../src/clients/githubClient")
const { fakeHttp, base64, silenceConsoleErrors } = require("../helpers")

const baseUrl = "https://api.github.test"
const repoUrl = "https://github.com/alice/app"

function client(routes, token = "secret") {
  const http = fakeHttp(routes)
  return { http, github: createGithubClient({ http, baseUrl, token }) }
}

describe("getGhaStatus", () => {
  test("returns conclusion and branch of the latest relevant run", async () => {
    const { github, http } = client({
      "GET /repos/alice/app/actions/runs": {
        status: 200,
        body: {
          workflow_runs: [
            { event: "schedule", conclusion: "failure", head_branch: "main" },
            { event: "push", conclusion: "success", head_branch: "dev" },
          ],
        },
      },
    })

    assert.deepEqual(await github.getGhaStatus(repoUrl), {
      conclusion: "success",
      branch: "dev",
      repoExists: true,
    })
    assert.equal(http.calls[0].headers.Authorization, "Bearer secret")
  })

  test("reports a running workflow by its status", async () => {
    const { github } = client({
      "GET /actions/runs": {
        status: 200,
        body: {
          workflow_runs: [
            { event: "push", conclusion: null, status: "in_progress" },
          ],
        },
      },
    })
    const { conclusion } = await github.getGhaStatus(repoUrl)
    assert.equal(conclusion, "in_progress")
  })

  test("reports no runs", async () => {
    const { github } = client({
      "GET /actions/runs": { status: 200, body: { workflow_runs: [] } },
    })
    assert.deepEqual(await github.getGhaStatus(repoUrl), {
      conclusion: "no runs",
      branch: null,
      repoExists: true,
    })
  })

  test("reports a missing repository without a separate existence check", async () => {
    const { github, http } = client({})
    assert.deepEqual(await github.getGhaStatus(repoUrl), {
      conclusion: "not found",
      branch: null,
      repoExists: false,
    })
    assert.equal(http.calls.length, 1)
  })

  test("distinguishes rate limiting from other API errors", async (t) => {
    silenceConsoleErrors(t)
    const limited = client({
      "GET /actions/runs": {
        status: 403,
        body: { message: "API rate limit exceeded" },
      },
    })
    const tooMany = client({
      "GET /actions/runs": { status: 429, body: { message: "Too Many Requests" } },
    })
    const secondary = client({
      "GET /actions/runs": {
        status: 403,
        body: { message: "You have exceeded a secondary rate limit" },
      },
    })
    const failing = client({
      "GET /actions/runs": { status: 500, body: { message: "Server Error" } },
    })

    for (const { github } of [limited, tooMany, secondary]) {
      const status = await github.getGhaStatus(repoUrl)
      assert.equal(status.conclusion, "rate limited")
      assert.equal(status.repoExists, null)
    }
    const status = await failing.github.getGhaStatus(repoUrl)
    assert.equal(status.conclusion, "error")
    assert.equal(status.repoExists, null)
  })

  test("reports network failures as errors", async (t) => {
    silenceConsoleErrors(t)
    const { github } = client({
      "GET /actions/runs": () => {
        throw new Error("ECONNRESET")
      },
    })
    assert.equal((await github.getGhaStatus(repoUrl)).conclusion, "error")
  })

  test("omits Authorization without a token", async (t) => {
    silenceConsoleErrors(t)
    const { github, http } = client({}, null)
    await github.getGhaStatus(repoUrl)
    assert.equal(http.calls[0].headers.Authorization, undefined)
  })

  test("returns null for a non-GitHub URL without calling the API", async () => {
    const { github, http } = client({})
    assert.equal(await github.getGhaStatus("https://gitlab.com/a/b"), null)
    assert.equal(http.calls.length, 0)
  })
})

describe("repoExists", () => {
  test("maps 200 to true, 404 to false and other statuses to null", async (t) => {
    silenceConsoleErrors(t)
    const ok = client({ "GET /repos/alice/app": { status: 200, body: {} } })
    const notFound = client({})
    const failing = client({ "GET /repos/alice/app": { status: 500, body: {} } })

    assert.equal(await ok.github.repoExists(repoUrl), true)
    assert.equal(await notFound.github.repoExists(repoUrl), false)
    assert.equal(await failing.github.repoExists(repoUrl), null)
  })
})

describe("getReadme", () => {
  test("decodes the README of a subdirectory", async () => {
    const { github, http } = client({
      "GET /repos/alice/app/readme/part4": {
        status: 200,
        body: { content: base64("# Part 4") },
      },
    })

    const readme = await github.getReadme(
      "https://github.com/alice/app/tree/main/part4",
    )
    assert.deepEqual(readme, { found: true, text: "# Part 4" })
    assert.match(http.calls[0].url, /\/readme\/part4$/)
  })

  test("keeps only the start of a very large README", async () => {
    const { github } = client({
      "GET /readme": {
        status: 200,
        body: { content: base64("x".repeat(MAX_README_LENGTH + 10)) },
      },
    })
    const { text } = await github.getReadme(repoUrl)
    assert.equal(text.length, MAX_README_LENGTH)
  })

  test("does not call the API for a crafted repository URL", async () => {
    const { github, http } = client({})
    const crafted = "https://github.com/a/b/tree/main/../../../../user"
    assert.equal(await github.getReadme(crafted), null)
    assert.equal(await github.repoExists(crafted), null)
    assert.equal(await github.getGhaStatus(crafted), null)
    assert.equal(http.calls.length, 0)
  })

  test("reports a missing README", async () => {
    const { github } = client({})
    assert.deepEqual(await github.getReadme(repoUrl), { found: false })
  })

  test("returns null when the README cannot be fetched", async (t) => {
    silenceConsoleErrors(t)
    const { github } = client({
      "GET /readme": { status: 403, body: { message: "Forbidden" } },
    })
    assert.equal(await github.getReadme(repoUrl), null)
  })
})
