const { test, describe, before, after, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { createApp } = require("../../src/app")
const { startServer } = require("../helpers")

const tabs = [
  {
    id: "k8s",
    name: "Kubernetes",
    completion: { courseModuleId: "module1", courseInstanceId: "inst1" },
    courses: [{ exerciseId: "k8s-ex", name: "kubernetes", courseId: "c2" }],
  },
  {
    id: "fs",
    name: "Full stack",
    courses: [
      { exerciseId: "ex1", name: "graphql", courseId: "c1", cheaters: true },
      { exerciseId: "pr-ex", name: "pull request", pr: true },
    ],
  },
]

const ANSWER = "33333333-3333-4333-8333-333333333333"
const STUDENT = "44444444-4444-4444-8444-444444444444"

describe("action log", () => {
  let server
  let upstream
  const rows = []
  const recentQueries = []
  const summaryQueries = []

  before(async () => {
    const mooc = {
      postGradingDecision: async () => upstream,
      postCompletions: async () => upstream,
      postCheaterAction: async () => upstream,
      getFlaggedCheaters: async () => new Map([[STUDENT, {}]]),
    }
    const pullRequestService = {
      approve: async () => ({ ok: true, label: "primary" }),
    }
    const invitationService = {
      listAccounts: () => [
        { index: 0, label: "primary" },
        { index: 1, label: "secondary" },
      ],
      accept: async () => ({ error: "Invitation not found" }),
      acceptAll: async (account) =>
        account === 1
          ? { ok: false, done: 2, failed: [{ repo: "x/y", reason: "boom" }] }
          : { ok: true, done: 0, failed: [] },
      declineExpired: async () => ({ ok: true, done: 1, failed: [] }),
    }
    server = await startServer(
      createApp({
        tabs,
        mooc,
        courseService: {},
        pullRequestService,
        invitationService,
        actionLog: {
          enabled: true,
          log: async (entry) => rows.push(entry),
          recent: async (query) => {
            recentQueries.push(query)
            return []
          },
          summary: async (query) => {
            summaryQueries.push(query)
            return []
          },
        },
        auth: { allowedUids: ["mluukkai"], enforce: true },
      }),
    )
  })

  after(() => server.close())

  beforeEach(() => {
    rows.length = 0
    upstream = { status: 200, body: {} }
  })

  function post(path, body) {
    return fetch(`${server.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", uid: "mluukkai" },
      body: JSON.stringify(body),
    })
  }

  test("a grade is logged with the admin, course and student", async () => {
    await post("/grade", {
      user_exercise_state_id: ANSWER,
      exercise_id: "ex1",
      action: "Other",
      justification: "tests must pass in GitHub",
      user_id: STUDENT,
    })
    assert.deepEqual(rows, [
      {
        actor_uid: "mluukkai",
        action: "reset",
        tab_id: "fs",
        course_id: "c1",
        exercise_id: "ex1",
        target_user_id: STUDENT,
        target_answer_id: ANSWER,
        details: { justification: "tests must pass in GitHub" },
        ok: true,
        error: null,
      },
    ])
  })

  test("a failed grade is logged with the mooc.fi error", async () => {
    upstream = { status: 401, body: { error: "Unauthorized" } }
    await post("/grade", { user_exercise_state_id: ANSWER, exercise_id: "ex1", action: "FullPoints" })
    assert.equal(rows[0].action, "full_points")
    assert.equal(rows[0].target_user_id, null)
    assert.equal(rows[0].ok, false)
    assert.equal(rows[0].error, "401: Unauthorized")
  })

  test("a rejected request is not logged", async () => {
    await post("/grade", { user_exercise_state_id: ANSWER, exercise_id: "nope", action: "FullPoints" })
    assert.deepEqual(rows, [])
  })

  test("a completion is logged with its grade", async () => {
    await post("/completion", {
      tab_id: "k8s",
      user_id: STUDENT,
      grade: 5,
      completion_date: "2026-10-20T00:00:00+00:00",
    })
    assert.equal(rows[0].action, "completion")
    assert.equal(rows[0].course_id, "inst1")
    assert.equal(rows[0].target_user_id, STUDENT)
    assert.deepEqual(rows[0].details, { grade: 5, completion_date: "2026-10-20T00:00:00+00:00" })
  })

  test("a pull request approval is logged with the approving account", async () => {
    await post("/approve-pr", { exercise_id: "pr-ex", pr_url: "https://github.com/x/y/pull/3", user_id: STUDENT })
    assert.equal(rows[0].action, "approve_pr")
    assert.equal(rows[0].tab_id, "fs")
    assert.deepEqual(rows[0].details, { pr_url: "https://github.com/x/y/pull/3", account: "primary" })
  })

  test("cheater actions are logged, marking all honest one row per user", async () => {
    await post("/confirm-cheater", { courseId: "c1", userId: STUDENT })
    await post("/dismiss-all-cheaters", { tab_id: "fs" })
    assert.deepEqual(
      rows.map(({ action, course_id, target_user_id, details }) => [action, course_id, target_user_id, details]),
      [
        ["cheater_confirm", "c1", STUDENT, undefined],
        ["cheater_dismiss", "c1", STUDENT, { bulk: true }],
      ],
    )
  })

  test("invitation actions are logged with the account label and their outcome", async () => {
    await post("/invitations/accept", { account: 0, invitationId: 7 })
    await post("/invitations/accept-all", { account: 1 })
    await post("/invitations/decline-expired", { account: 0 })
    assert.deepEqual(
      rows.map(({ action, details, ok, error }) => [action, details, ok, error]),
      [
        ["invite_accept", { account: "primary", invitationId: 7 }, false, "Invitation not found"],
        ["invite_accept_all", { account: "secondary", done: 2, failed: ["x/y"] }, false, "1 failed"],
        ["invite_decline_expired", { account: "primary", done: 1 }, true, null],
      ],
    )
  })

  test("accepting all on an account without invitations is not logged", async () => {
    const response = await post("/invitations/accept-all", { account: 0 })
    assert.equal(response.status, 200)
    assert.deepEqual(rows, [])
  })

  test("GET /log shows the rows matching the filters of the query", async () => {
    const response = await fetch(`${server.url}/log?view=actions&action=reset&failed=1`, { headers: { uid: "mluukkai" } })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<h1>Action log<\/h1>/)
    assert.equal(recentQueries.at(-1).filters.action, "reset")
    assert.equal(recentQueries.at(-1).filters.failed, true)
  })

  test("GET /log shows the daily counts matching the filters by default", async () => {
    const response = await fetch(`${server.url}/log?tab=fs`, { headers: { uid: "mluukkai" } })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<a href="\/log\?tab=fs" class="active" aria-current="page">Daily summary<\/a>/)
    assert.equal(summaryQueries.at(-1).filters.tabId, "fs")
  })

  test("GET /log?view=report sums up the range and lists its failed actions", async () => {
    const response = await fetch(`${server.url}/log?view=report&from=2026-10-12&to=2026-10-18`, { headers: { uid: "mluukkai" } })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<h2>Report: 2026-10-12 – 2026-10-18<\/h2>/)
    assert.equal(summaryQueries.at(-1).filters.from, "2026-10-12")
    assert.equal(recentQueries.at(-1).filters.to, "2026-10-18")
    assert.equal(recentQueries.at(-1).filters.failed, true)
  })
})
