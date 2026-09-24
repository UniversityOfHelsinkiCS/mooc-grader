const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  parseGitHubRepo,
  readmeHasQrCode,
  extractReadmeUrls,
  readmeLinksOk,
  selectRelevantRun,
  isGhaFailed,
  isGhaPassing,
  ghaOutcome,
} = require("../../src/domain/repository")

describe("parseGitHubRepo", () => {
  test("parses owner and repo", () => {
    assert.deepEqual(parseGitHubRepo("https://github.com/alice/todo-app"), {
      owner: "alice",
      repo: "todo-app",
      dir: null,
    })
  })

  test("strips .git suffix, query and fragment", () => {
    assert.equal(parseGitHubRepo("https://github.com/a/b.git").repo, "b")
    assert.equal(parseGitHubRepo("https://github.com/a/b?tab=readme").repo, "b")
    assert.equal(parseGitHubRepo("https://github.com/a/b#readme").repo, "b")
  })

  test("parses subdirectory of a tree URL", () => {
    assert.deepEqual(
      parseGitHubRepo("https://github.com/a/monorepo/tree/main/part3/app/"),
      { owner: "a", repo: "monorepo", dir: "part3/app" },
    )
  })

  test("finds the repo inside surrounding text", () => {
    assert.equal(
      parseGitHubRepo("my repo is github.com/a/b thanks").repo,
      "b",
    )
  })

  test("stops the repo name at characters GitHub does not allow", () => {
    assert.equal(parseGitHubRepo("(https://github.com/a/b)").repo, "b")
  })

  test("rejects path tricks that would point API calls elsewhere", () => {
    const crafted = [
      "https://github.com/../../user",
      "https://github.com/a/../../user",
      "https://github.com/a/b/tree/main/../../other/private/contents/secret",
      "https://github.com/a/b/tree/main/part3/./app",
      "https://github.com/a/.git",
    ]
    for (const url of crafted) {
      assert.equal(parseGitHubRepo(url), null, url)
    }
  })

  test("ignores an encoded subdirectory instead of passing it on", () => {
    assert.deepEqual(
      parseGitHubRepo("https://github.com/a/b/tree/main/%2e%2e/x"),
      { owner: "a", repo: "b", dir: null },
    )
  })

  test("returns null for non-GitHub URLs and bare profiles", () => {
    assert.equal(parseGitHubRepo("https://gitlab.com/a/b"), null)
    assert.equal(parseGitHubRepo("https://github.com/alice"), null)
  })
})

describe("readmeHasQrCode", () => {
  const positives = [
    "Scan the QR code below",
    "![qr](./assets/qr-code.png)",
    "<img src='https://api.qrserver.com/v1/create-qr-code/?data=exp://x'>",
    "Escanea el código QR con Expo Go",
    "Open https://qr.expo.dev/eas-update?projectId=1",
  ]
  for (const text of positives) {
    test(`detects: ${text}`, () => {
      assert.equal(readmeHasQrCode(text), true)
    })
  }

  test("stays fast on crafted input", () => {
    const start = Date.now()
    readmeHasQrCode("(".repeat(100_000))
    readmeHasQrCode("![".repeat(50_000))
    // the quadratic versions took over a minute on this input
    assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`)
  })

  test("does not match unrelated text", () => {
    assert.equal(
      readmeHasQrCode("# Rate repository app\nRun npm start and open Expo."),
      false,
    )
  })
})

describe("extractReadmeUrls", () => {
  test("collects markdown and plain URLs without duplicates", () => {
    const text = [
      "[App](https://app.example.com)",
      "Repo: https://github.com/a/b",
      "Again https://app.example.com",
      "[local](./docs/setup.md)",
    ].join("\n")
    assert.deepEqual(extractReadmeUrls(text), [
      "https://app.example.com",
      "https://github.com/a/b",
    ])
  })

  test("stays fast on crafted input", () => {
    const start = Date.now()
    extractReadmeUrls("[".repeat(100_000))
    extractReadmeUrls("[x](".repeat(25_000))
    // the quadratic versions took over a minute on this input
    assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`)
  })

  test("returns an empty list when there are no URLs", () => {
    assert.deepEqual(extractReadmeUrls("# Title"), [])
  })
})

describe("readmeLinksOk", () => {
  test("requires enough links including a GitHub link", () => {
    assert.equal(
      readmeLinksOk(["https://app.fly.dev", "https://github.com/a/b"], 2),
      true,
    )
    assert.equal(readmeLinksOk(["https://github.com/a/b"], 2), false)
    assert.equal(
      readmeLinksOk(["https://app.fly.dev", "https://example.com"], 2),
      false,
    )
  })
})

describe("selectRelevantRun", () => {
  test("skips scheduled and health-check runs", () => {
    const runs = [
      { id: 1, event: "schedule", path: ".github/workflows/pipeline.yml" },
      { id: 2, event: "push", path: ".github/workflows/health-check.yml" },
      { id: 3, event: "push", name: "periodic ping" },
      { id: 4, event: "push", path: ".github/workflows/pipeline.yml" },
    ]
    assert.equal(selectRelevantRun(runs).id, 4)
  })

  test("returns null when no run qualifies", () => {
    assert.equal(selectRelevantRun([{ event: "schedule" }]), null)
    assert.equal(selectRelevantRun([]), null)
  })
})

describe("isGhaPassing", () => {
  test("is unknown when the status could not be looked up", () => {
    assert.equal(isGhaPassing("rate limited"), null)
    assert.equal(isGhaPassing("error"), null)
    assert.equal(isGhaPassing(undefined), null)
  })

  test("passes only on success", () => {
    assert.equal(isGhaPassing("success"), true)
    assert.equal(isGhaPassing("failure"), false)
    assert.equal(isGhaPassing("no runs"), false)
  })
})

describe("ghaOutcome", () => {
  test("groups every status into one of four badge styles", () => {
    const cases = {
      success: "success",
      failure: "failure",
      timed_out: "failure",
      startup_failure: "failure",
      in_progress: "pending",
      queued: "pending",
      action_required: "pending",
      cancelled: "neutral",
      skipped: "neutral",
      "no runs": "neutral",
      "rate limited": "neutral",
      error: "neutral",
      "n/a": "neutral",
      "something new": "neutral",
    }
    for (const [conclusion, outcome] of Object.entries(cases)) {
      assert.equal(ghaOutcome(conclusion), outcome, conclusion)
    }
  })
})

describe("isGhaFailed", () => {
  test("counts failing and unfinished runs as failed", () => {
    assert.equal(isGhaFailed("failure"), true)
    assert.equal(isGhaFailed("no runs"), true)
  })

  test("does not blame the student for success or API problems", () => {
    assert.equal(isGhaFailed("success"), false)
    assert.equal(isGhaFailed("rate limited"), false)
    assert.equal(isGhaFailed("error"), false)
    assert.equal(isGhaFailed(undefined), false)
  })
})
