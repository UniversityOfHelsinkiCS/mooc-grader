const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { createAutoGrader } = require("../../src/services/autoGrader")

const tabs = [
  {
    id: "fs",
    name: "Full stack",
    courses: [
      { exerciseId: "ex1", name: "graphql", courseId: "c1", gha: true },
      { exerciseId: "pr-ex", name: "pull request", courseId: "c2", pr: true, gha: true },
    ],
  },
  {
    id: "k8s",
    name: "Kubernetes",
    completion: { courseModuleId: "m1", courseInstanceId: "i1" },
    courses: [{ exerciseId: "k8s-ex", name: "kubernetes", courseId: "c3" }],
  },
]

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const repo = "https://github.com/student/repo"

function ghaAnswer(n, conclusion, repoExists = true) {
  return {
    id: uuid(n),
    user_id: uuid(100 + n),
    _repoUrl: repo,
    _repoExists: repoExists,
    _ghaStatus: conclusion ? { conclusion } : null,
  }
}

function prAnswer(n, { approvedBy = [], conclusion = "success" } = {}) {
  return {
    id: uuid(n),
    user_id: uuid(100 + n),
    _prUrl: `https://github.com/student/repo/pull/${n}`,
    _prApprovedBy: approvedBy,
    _ghaStatus: { conclusion },
  }
}

function setup({ courses, invitations = { ok: true, done: 0, failed: [] }, gradeStatus = 200 }) {
  const rows = []
  const grades = []
  const approvals = []
  const fetched = []
  const autoGrader = createAutoGrader({
    tabs,
    mooc: {
      postGradingDecision: async (payload) => {
        grades.push(payload)
        return { status: gradeStatus, body: {} }
      },
    },
    courseService: {
      fetchTabData: async (tab) => {
        fetched.push(tab.id)
        return courses(tab)
      },
    },
    invitationService: {
      listAccounts: () => [{ index: 0, label: "primary" }],
      acceptAll: async () => invitations,
    },
    pullRequestService: {
      approve: async (prUrl) => {
        approvals.push(prUrl)
        return { ok: true, label: "primary" }
      },
    },
    actionLog: { log: async (entry) => rows.push(entry) },
  })
  return { autoGrader, rows, grades, approvals, fetched }
}

function course(tabCourse, answers) {
  return { ...tabCourse, pr: !!tabCourse.pr, gha: !!tabCourse.gha, qr: false, linkCount: null, answers }
}

describe("autoGrader", () => {
  test("grades the answers like Doit all, logging every action as node-cron", async () => {
    const { autoGrader, rows, grades, approvals, fetched } = setup({
      invitations: { ok: true, done: 2, failed: [] },
      courses: () => [
        course(tabs[0].courses[0], [
          ghaAnswer(1, "success"),
          ghaAnswer(2, "failure"),
          ghaAnswer(3, null),
          ghaAnswer(4, "success", false),
        ]),
        course(tabs[0].courses[1], [
          prAnswer(5),
          prAnswer(6, { conclusion: null }),
          prAnswer(7, { approvedBy: ["mluukkai"], conclusion: "failure" }),
          prAnswer(8, { approvedBy: ["mluukkai"] }),
        ]),
      ],
    })

    const totals = await autoGrader.run()

    // Tabs with completions are graded by hand
    assert.deepEqual(fetched, ["fs"])
    // Only the pull request whose other checks passed is approved
    assert.deepEqual(approvals, ["https://github.com/student/repo/pull/5"])
    assert.deepEqual(
      grades.map((grade) => [grade.user_exercise_state_id, grade.action, grade.justification?.split(".")[0] ?? null]),
      [
        [uuid(5), "FullPoints", null],
        [uuid(1), "FullPoints", null],
        [uuid(8), "FullPoints", null],
        [uuid(2), "Other", "tests must pass in GitHub"],
        [uuid(4), "Other", "repository must be accessible by user mluukkai"],
      ],
    )
    assert.deepEqual(totals, { invitations: 2, approved: 1, full_points: 2, reset: 2, failed: 0, notLoaded: [] })

    assert.ok(rows.every((row) => row.actor_uid === "node-cron"))
    assert.deepEqual(
      rows.map((row) => row.action),
      ["invite_accept_all", "approve_pr", "full_points", "full_points", "full_points", "reset", "reset", "auto_grade_run"],
    )
    assert.deepEqual(rows[1], {
      actor_uid: "node-cron",
      action: "approve_pr",
      tab_id: "fs",
      course_id: "c2",
      exercise_id: "pr-ex",
      target_user_id: uuid(105),
      details: { pr_url: "https://github.com/student/repo/pull/5", account: "primary" },
      ok: true,
      error: null,
    })
    assert.deepEqual(rows.at(-1), {
      actor_uid: "node-cron",
      action: "auto_grade_run",
      details: { invitations: 2, approved: 1, full_points: 2, reset: 2, failed: 0 },
      ok: true,
      error: null,
    })
  })

  test("a run with nothing to do logs only the run", async () => {
    const { autoGrader, rows } = setup({ courses: () => [course(tabs[0].courses[0], [])] })
    await autoGrader.run()
    assert.deepEqual(rows.map((row) => row.action), ["auto_grade_run"])
    assert.equal(rows[0].ok, true)
  })

  test("failed grades and courses that cannot be loaded make the run fail", async () => {
    const { autoGrader, rows } = setup({
      gradeStatus: 401,
      courses: () => [
        course(tabs[0].courses[0], [ghaAnswer(1, "success")]),
        { name: "pull request", error: "mooc.fi down" },
      ],
    })
    const totals = await autoGrader.run()
    assert.equal(totals.failed, 1)
    assert.equal(rows[0].ok, false)
    assert.equal(rows[0].error, "401")
    assert.equal(rows.at(-1).ok, false)
    assert.equal(rows.at(-1).error, "could not load: fs/pull request (mooc.fi down)")
  })

  test("a run is not started while one is going", async () => {
    let release
    const { autoGrader } = setup({
      courses: () => new Promise((resolve) => (release = () => resolve([]))),
    })
    const first = autoGrader.run()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(await autoGrader.run(), null)
    release()
    assert.notEqual(await first, null)
  })
})
