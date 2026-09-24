const { test, describe, before, after } = require("node:test")
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
      { exerciseId: "ex1", name: "graphql", gha: true, courseId: "c1", cheaters: true },
    ],
  },
  {
    id: "other",
    name: "Other",
    completion: { courseModuleId: "module2", courseInstanceId: "inst2" },
    courses: [{ exerciseId: "other-ex", name: "other", courseId: "c3" }],
  },
]
const noAuth = { allowedUids: [], enforce: false }

function overview(tab) {
  return {
    id: tab.id,
    name: tab.name,
       answerCount: 3,
    cheaterCount: 0,
    failed: [],
  }
}

function emptyCourse(course) {
  return {
    exerciseId: course.exerciseId,
    courseId: course.courseId ?? null,
    name: course.name,
    gha: !!course.gha,
    qr: false,
    linkCount: null,
    cheaterCount: null,
    answers: [],
  }
}

describe("routes", () => {
  let server
  let upstream
  const moocCalls = []

  before(async () => {
    const record = (name) => async (...args) => {
      moocCalls.push([name, ...args])
      return upstream
    }
    const mooc = {
      postGradingDecision: record("grading"),
      postCompletions: record("completions"),
      postCheaterAction: record("cheater"),
    }
    const courseService = {
      fetchTabData: async (tab) => tab.courses.map(emptyCourse),
      fetchTabOverview: async (tab) => overview(tab),
      fetchCheatersData: async (course) => ({ name: course.name, cheaters: [] }),
    }
    server = await startServer(
      createApp({ tabs, mooc, courseService, auth: noAuth }),
    )
  })

  after(() => server.close())

  function post(path, body) {
    return fetch(`${server.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  describe("POST /grade", () => {
    test("forwards a grading decision to mooc.fi", async () => {
      upstream = { status: 200, body: { id: "decision1" } }
      moocCalls.length = 0

      const response = await post("/grade", {
        user_exercise_state_id: "33333333-3333-4333-8333-333333333333",
        exercise_id: "ex1",
        action: "ZeroPoints",
      })

      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), {
        ok: true,
        status: 200,
        body: { id: "decision1" },
      })
      const [[name, payload]] = moocCalls
      assert.equal(name, "grading")
      assert.equal(payload.action, "ZeroPoints")
      assert.equal(payload.user_exercise_state_id, "33333333-3333-4333-8333-333333333333")
    })

    test("relays mooc.fi errors", async () => {
      upstream = { status: 401, body: { error: "Unauthorized" } }
      const response = await post("/grade", {
        user_exercise_state_id: "33333333-3333-4333-8333-333333333333",
        exercise_id: "ex1",
        action: "FullPoints",
      })
      assert.equal(response.status, 401)
      assert.equal((await response.json()).ok, false)
    })

    test("rejects invalid requests without calling mooc.fi", async () => {
      moocCalls.length = 0
      const cases = [
        [{ exercise_id: "ex1" }, "Missing user_exercise_state_id or exercise_id"],
        [{ user_exercise_state_id: "33333333-3333-4333-8333-333333333333", exercise_id: "nope" }, "Unknown exercise_id"],
        [
          { user_exercise_state_id: "33333333-3333-4333-8333-333333333333", exercise_id: "ex1", action: "Other" },
          "Missing justification",
        ],
        [{ user_exercise_state_id: "33333333-3333-4333-8333-333333333333", exercise_id: "ex1" }, "Invalid action"],
        [
          { user_exercise_state_id: "ues1", exercise_id: "ex1", action: "FullPoints" },
          "Invalid user_exercise_state_id",
        ],
        [
          { user_exercise_state_id: "33333333-3333-4333-8333-333333333333", exercise_id: "ex1", action: "Bogus" },
          "Invalid action",
        ],
      ]
      for (const [body, error] of cases) {
        const response = await post("/grade", body)
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error, error)
      }
      assert.equal(moocCalls.length, 0)
    })
  })

  describe("POST /completion", () => {
    test("posts the completion to the course instance of its tab", async () => {
      upstream = { status: 200, body: [] }
      moocCalls.length = 0

      for (const tab_id of ["k8s", "other"]) {
        const response = await post("/completion", {
          tab_id,
          user_id: "44444444-4444-4444-8444-444444444444",
          grade: 5,
          completion_date: "2026-09-24T00:00:00+00:00",
        })
        assert.equal(response.status, 200)
      }

      const [[name, instanceId, payload], [, otherInstanceId, otherPayload]] =
        moocCalls
      assert.equal(name, "completions")
      assert.equal(instanceId, "inst1")
      assert.equal(payload.course_module_id, "module1")
      assert.equal(payload.new_completions[0].passed, true)
      assert.equal(otherInstanceId, "inst2")
      assert.equal(otherPayload.course_module_id, "module2")
    })

    test("rejects tabs without completions", async () => {
      moocCalls.length = 0
      for (const tab_id of ["fs", "nope", undefined]) {
        const response = await post("/completion", { tab_id, user_id: "44444444-4444-4444-8444-444444444444", grade: 5 })
        assert.equal(response.status, 400, String(tab_id))
        assert.match((await response.json()).error, /Unknown tab_id/)
      }
      assert.equal(moocCalls.length, 0)
    })

    test("requires a user id", async () => {
      const response = await post("/completion", { tab_id: "k8s", grade: 5 })
      assert.equal(response.status, 400)
    })

    test("rejects an unknown grade without calling mooc.fi", async () => {
      moocCalls.length = 0
      for (const grade of [undefined, null, 0.5, "5"]) {
        const response = await post("/completion", { tab_id: "k8s", user_id: "44444444-4444-4444-8444-444444444444", grade })
        assert.equal(response.status, 400)
        assert.match((await response.json()).error, /Invalid grade/)
      }
      assert.equal(moocCalls.length, 0)
    })
  })

  describe("cheater actions", () => {
    test("confirm and dismiss are forwarded for known courses", async () => {
      upstream = { status: 200, body: null }
      moocCalls.length = 0

      await post("/confirm-cheater", { courseId: "c1", userId: "11111111-1111-4111-8111-111111111111" })
      await post("/dismiss-cheater", { courseId: "c1", userId: "22222222-2222-4222-8222-222222222222" })

      assert.deepEqual(moocCalls, [
        ["cheater", "c1", "confirm", "11111111-1111-4111-8111-111111111111"],
        ["cheater", "c1", "dismiss", "22222222-2222-4222-8222-222222222222"],
      ])
    })

    test("user ids that are not UUIDs are rejected", async () => {
      moocCalls.length = 0
      for (const userId of ["../../../../exercises/x", "u1", 42]) {
        const response = await post("/confirm-cheater", { courseId: "c1", userId })
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error, "Invalid userId")
      }
      assert.equal(moocCalls.length, 0)
    })

    test("courses without the cheaters feature are rejected", async () => {
      for (const courseId of ["x", "c2"]) {
        const response = await post("/confirm-cheater", { courseId, userId: "11111111-1111-4111-8111-111111111111" })
        assert.equal(response.status, 400)
        assert.equal((await response.json()).error, "Unknown courseId")
      }
    })
  })

  describe("pages", () => {
    test("GET / links every tab with its totals", async () => {
      const response = await fetch(`${server.url}/`)
      const html = await response.text()
      assert.equal(response.status, 200)
      for (const tab of tabs) {
        assert.ok(html.includes(`<a href="/${tab.id}">${tab.name}</a>`), tab.id)
      }
      assert.ok(!html.includes("graphql"))
    })

    test("GET /:tabId renders the courses of the tab", async () => {
      const fullstack = await (await fetch(`${server.url}/fs`)).text()
      assert.ok(fullstack.includes("<h1>Full stack</h1>"))
      assert.ok(fullstack.includes("graphql"))
      assert.ok(!fullstack.includes("kubernetes"))

      const kubernetes = await (await fetch(`${server.url}/k8s`)).text()
      assert.ok(kubernetes.includes('class="compact"'))
      assert.ok(kubernetes.includes("kubernetes"))

      for (const path of ["/ex1", "/tab/k8s", "/k8s/extra"]) {
        const response = await fetch(`${server.url}${path}`)
        assert.equal(response.status, 404, path)
      }
    })

    test("GET /cheaters/:courseId renders courses with cheaters enabled", async () => {
      const ok = await fetch(`${server.url}/cheaters/c1`)
      assert.equal(ok.status, 200)
      assert.ok((await ok.text()).includes("Suspected cheaters"))

      for (const courseId of ["nope", "c2"]) {
        const response = await fetch(`${server.url}/cheaters/${courseId}`)
        assert.equal(response.status, 404)
      }
    })

    test("serves the static assets", async () => {
      for (const file of ["styles.css", "grading.js", "cheaters.js"]) {
        const response = await fetch(`${server.url}/static/${file}`)
        assert.equal(response.status, 200, file)
      }
    })
  })
})

describe("page errors", () => {
  test("a failing tab page shows an escaped error", async () => {
    const courseService = {
      fetchTabData: async () => {
        throw new Error("cookie <expired>")
      },
    }
    const server = await startServer(
      createApp({ tabs, mooc: {}, courseService, auth: noAuth }),
    )
    try {
      const response = await fetch(`${server.url}/k8s`)
      assert.equal(response.status, 500)
      assert.equal(await response.text(), "<pre>cookie &lt;expired&gt;</pre>")
    } finally {
      await server.close()
    }
  })
})
