const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  createPullRequestService,
  APPROVAL_COMMENT,
} = require("../../src/services/pullRequestService")

// Fake accounts client; failing: account index -> error message
function fakeAccounts(failing = {}) {
  const calls = []
  const accounts = [
    { index: 0, label: "primary" },
    { index: 1, label: "secondary" },
  ]
  return {
    calls,
    listAccounts: () => accounts,
    findAccount: (index) => accounts[index],
    approvePullRequest: async (account, pullRequest, comment) => {
      calls.push([account.index, pullRequest, comment])
      if (failing[account.index]) throw new Error(failing[account.index])
    },
  }
}

const prUrl = "https://github.com/alice/app/pull/3"

describe("pullRequestService.approve", () => {
  test("approves with the first account", async () => {
    const accounts = fakeAccounts()
    const service = createPullRequestService({ accounts })

    assert.deepEqual(await service.approve(prUrl), { ok: true, label: "primary" })
    assert.deepEqual(accounts.calls, [
      [0, { owner: "alice", repo: "app", number: 3 }, APPROVAL_COMMENT],
    ])
  })

  test("falls back to the next account when one fails", async () => {
    const accounts = fakeAccounts({ 0: "GitHub 422: Can not approve your own pull request" })
    const approved = []
    const service = createPullRequestService({
      accounts,
      onApproved: (repo) => approved.push(repo),
    })

    assert.deepEqual(await service.approve(prUrl), { ok: true, label: "secondary" })
    assert.deepEqual(approved, ["alice/app"])
  })

  test("reports the failure of every account", async () => {
    const accounts = fakeAccounts({ 0: "GitHub 404: Not Found", 1: "GitHub 401: Bad credentials" })
    const service = createPullRequestService({
      accounts,
      onApproved: () => assert.fail("nothing was approved"),
    })

    assert.deepEqual(await service.approve(prUrl), {
      error: "primary: GitHub 404: Not Found; secondary: GitHub 401: Bad credentials",
    })
  })

  test("does not call GitHub for a link that is not a pull request", async () => {
    const accounts = fakeAccounts()
    const service = createPullRequestService({ accounts })

    assert.deepEqual(await service.approve("https://github.com/alice/app"), {
      error: "Not a GitHub pull request link",
    })
    assert.deepEqual(accounts.calls, [])
  })
})
