const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { createCourseService } = require("../../src/services/courseService")
const { answer } = require("../helpers")

// Fake clients that record which GitHub checks were run
function fakeClients({
  answers = [],
  readmes = {},
  cheaters = new Map(),
  points = {},
  details = {},
  statuses = {},
  submissions = {},
} = {}) {
  const githubCalls = []
  const moocUserCalls = []
  const mooc = {
    fetchAllAnswers: async () => structuredClone(answers),
    getFlaggedCheaters: async () => cheaters,
    getUserCoursePoints: async (courseId, userId) => {
      moocUserCalls.push(["points", userId])
      return points[userId] ?? null
    },
    getUserDetails: async (courseId, userId) => {
      moocUserCalls.push(["details", userId])
      return details[userId] ?? null
    },
    getExerciseStatuses: async (courseId, userId) => statuses[userId] ?? [],
    getSubmissionTasks: async (id) => submissions[id] ?? null,
  }
  const github = {
    getGhaStatus: async (url) => {
      githubCalls.push(["gha", url])
      return url.includes("private")
        ? { conclusion: "not found", branch: null, repoExists: false }
        : { conclusion: "success", branch: "main", repoExists: true }
    },
    repoExists: async (url) => {
      githubCalls.push(["exists", url])
      return !url.includes("private")
    },
    getReadme: async (url) => {
      githubCalls.push(["readme", url])
      return url in readmes ? readmes[url] : { found: false }
    },
  }
  return { mooc, github, githubCalls, moocUserCalls }
}

const repo = "https://github.com/alice/app"

describe("fetchCourseData", () => {
  test("annotates answers with the repository and GHA status", async () => {
    const clients = fakeClients({
      answers: [
        answer({ id: "a1", userId: "u1", texts: ["My solution", repo] }),
        answer({
          id: "a2",
          userId: "u2",
          texts: ["https://github.com/bob/private"],
        }),
      ],
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({ exerciseId: "ex", name: "ci", gha: true })

    const [first, second] = result.answers
    assert.equal(first._repoUrl, repo)
    assert.equal(first._repoExists, true)
    assert.equal(first._ghaStatus.conclusion, "success")
    assert.equal(second._repoExists, false)
    assert.equal(result.gha, true)
    assert.equal(result.cheaterCount, null)
  })

  test("takes repo existence from the GHA call instead of a separate check", async () => {
    const clients = fakeClients({
      answers: [answer({ id: "a1", userId: "u1", texts: [repo] })],
    })
    const service = createCourseService(clients)

    await service.fetchCourseData({ exerciseId: "ex", name: "ci", gha: true })

    assert.deepEqual(clients.githubCalls, [["gha", repo]])
  })

  test("fetches the README once for both README checks", async () => {
    const clients = fakeClients({
      answers: [answer({ id: "a1", userId: "u1", texts: [repo] })],
      readmes: {
        [repo]: {
          found: true,
          text: "Scan the QR code. [app](https://app.fly.dev) https://github.com/a/b",
        },
      },
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({
      exerciseId: "ex",
      name: "both",
      qr: true,
      linkCount: 2,
    })

    const readmeCalls = clients.githubCalls.filter(([kind]) => kind === "readme")
    assert.equal(readmeCalls.length, 1)
    assert.equal(result.answers[0]._qrExists, true)
    assert.equal(result.answers[0]._linksOk, true)
  })

  test("runs only the checks enabled for the course", async () => {
    const clients = fakeClients({
      answers: [answer({ id: "a1", userId: "u1", texts: [repo] })],
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({ exerciseId: "ex", name: "psql" })

    assert.deepEqual(clients.githubCalls, [["exists", repo]])
    assert.equal(result.answers[0]._ghaStatus, undefined)
    assert.equal(result.answers[0]._qrExists, undefined)
  })

  test("skips GitHub entirely for answers without a repository", async () => {
    const clients = fakeClients({
      answers: [answer({ id: "a1", userId: "u1", texts: ["no link here"] })],
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({
      exerciseId: "ex",
      name: "all",
      gha: true,
      qr: true,
      linkCount: 2,
    })

    const [item] = result.answers
    assert.deepEqual(clients.githubCalls, [])
    assert.equal(item._repoUrl, null)
    assert.equal(item._repoExists, null)
    assert.equal(item._ghaStatus, null)
    assert.deepEqual(item._readmeUrls, [])
    assert.equal(item._qrExists, null)
    assert.equal(item._linksOk, null)
  })

  test("checks the README for a QR code", async () => {
    const withQr = "https://github.com/a/with-qr"
    const withoutQr = "https://github.com/a/without-qr"
    const unreadable = "https://github.com/a/unreadable"
    const clients = fakeClients({
      answers: [
        answer({ id: "1", userId: "u1", texts: [withQr] }),
        answer({ id: "2", userId: "u2", texts: [withoutQr] }),
        answer({ id: "3", userId: "u3", texts: [unreadable] }),
        answer({ id: "4", userId: "u4", texts: [repo] }),
      ],
      readmes: {
        [withQr]: { found: true, text: "Scan the QR code with Expo Go" },
        [withoutQr]: { found: true, text: "# My app" },
        [unreadable]: null,
      },
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({ exerciseId: "ex", name: "rn", qr: true })

    assert.deepEqual(
      result.answers.map((item) => item._qrExists),
      [true, false, null, false],
    )
  })

  test("checks the README links against the required count", async () => {
    const good = "https://github.com/a/good"
    const bad = "https://github.com/a/bad"
    const clients = fakeClients({
      answers: [
        answer({ id: "1", userId: "u1", texts: [good] }),
        answer({ id: "2", userId: "u2", texts: [bad] }),
      ],
      readmes: {
        [good]: {
          found: true,
          text: "[app](https://app.fly.dev) and https://github.com/a/good",
        },
        [bad]: { found: true, text: "Deployed at https://app.fly.dev" },
      },
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({
      exerciseId: "ex",
      name: "ci",
      linkCount: 2,
    })

    const [goodItem, badItem] = result.answers
    assert.equal(goodItem._linksOk, true)
    assert.deepEqual(goodItem._readmeUrls, [
      "https://app.fly.dev",
      "https://github.com/a/good",
    ])
    assert.equal(badItem._linksOk, false)
  })

  test("adds course points and user details when asked", async () => {
    const clients = fakeClients({
      answers: [
        answer({ id: "a1", userId: "u1" }),
        answer({ id: "a2", userId: "u2" }),
      ],
      points: { u1: 45 },
      details: { u1: { name: "Ada", email: "ada@x.fi" } },
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData(
      { exerciseId: "ex", name: "kubernetes", courseId: "course1" },
      { withUserInfo: true },
    )

    const [ada, other] = result.answers
    assert.equal(ada._coursePoints, 45)
    assert.equal(ada._userName, "Ada")
    assert.equal(ada._userEmail, "ada@x.fi")
    assert.equal(other._coursePoints, null)
    assert.equal(other._userName, null)
  })

  test("counts flagged cheaters of the course", async () => {
    const clients = fakeClients({
      cheaters: new Map([["u1", {}], ["u2", {}]]),
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({
      exerciseId: "ex",
      name: "graphql",
      courseId: "course1",
      cheaters: true,
    })

    assert.equal(result.cheaterCount, 2)
    assert.equal(result.courseId, "course1")
  })

  test("fetches cheaters and user info only when enabled", async () => {
    const clients = fakeClients({
      answers: [answer({ id: "a1", userId: "u1" })],
      cheaters: new Map([["u1", {}]]),
      points: { u1: 45 },
      details: { u1: { name: "Ada", email: "ada@x.fi" } },
    })
    const service = createCourseService(clients)

    const result = await service.fetchCourseData({
      exerciseId: "ex",
      name: "graphql",
      courseId: "course1",
    })

    assert.equal(result.cheaterCount, null)
    assert.equal(result.answers[0]._coursePoints, null)
    assert.equal(result.answers[0]._userName, null)
  })
})

describe("fetchTabData", () => {
  test("loads user info only for tabs with completions", async () => {
    const clients = fakeClients({
      answers: [answer({ id: "a1", userId: "u1" })],
      points: { u1: 45 },
    })
    const service = createCourseService(clients)
    const course = { exerciseId: "ex", name: "k8s", courseId: "course1" }

    const [plain] = await service.fetchTabData({ id: "fs", courses: [course] })
    assert.equal(plain.answers[0]._coursePoints, null)
    assert.deepEqual(clients.moocUserCalls, [])

    const [withCompletion] = await service.fetchTabData({
      id: "k8s",
      completion: { courseModuleId: "m", courseInstanceId: "i" },
      courses: [course],
    })
    assert.equal(withCompletion.answers[0]._coursePoints, 45)
  })

  test("returns a failing course as its error and still loads the others", async (t) => {
    t.mock.method(console, "error", () => {})
    const clients = fakeClients({ answers: [answer({ id: "a1", userId: "u1" })] })
    const fetchAllAnswers = clients.mooc.fetchAllAnswers
    clients.mooc.fetchAllAnswers = async (exerciseId) => {
      if (exerciseId === "broken") throw new Error("cookie expired")
      return fetchAllAnswers(exerciseId)
    }
    const service = createCourseService(clients)

    const [broken, working] = await service.fetchTabData({
      id: "fs",
      courses: [
        { exerciseId: "broken", name: "graphql" },
        { exerciseId: "ok", name: "ci" },
      ],
    })

    assert.deepEqual(broken, { name: "graphql", error: "cookie expired" })
    assert.equal(working.answers.length, 1)
  })
})

describe("fetchTabOverview", () => {
  test("sums answers and flagged cheaters without user lookups or repository checks", async () => {
    const clients = fakeClients({
      answers: [
        answer({ id: "a1", userId: "u1", texts: [repo] }),
        answer({ id: "a2", userId: "u2" }),
      ],
      cheaters: new Map([["u1", {}]]),
    })
    const service = createCourseService(clients)

    const overview = await service.fetchTabOverview({
      id: "fs",
      name: "Full stack",
      courses: [
        { exerciseId: "e1", name: "graphql", courseId: "c1", cheaters: true },
        { exerciseId: "e2", name: "ci" },
      ],
    })

    assert.deepEqual(overview, {
      id: "fs",
      name: "Full stack",
           answerCount: 4,
      cheaterCount: 1,
      failed: [],
    })
    assert.deepEqual(clients.moocUserCalls, [])
    assert.deepEqual(clients.githubCalls, [])
  })

  test("reports courses that could not be counted", async (t) => {
    t.mock.method(console, "error", () => {})
    const clients = fakeClients({ answers: [answer({ id: "a1", userId: "u1" })] })
    clients.mooc.fetchAllAnswers = async (exerciseId) => {
      if (exerciseId === "broken") throw new Error("cookie expired")
      return [answer({ id: "a1", userId: "u1" })]
    }
    const service = createCourseService(clients)

    const overview = await service.fetchTabOverview({
      id: "fs",
      name: "Full stack",
      courses: [
        { exerciseId: "broken", name: "graphql" },
        { exerciseId: "ok", name: "ci" },
      ],
    })

    assert.equal(overview.answerCount, 1)
    assert.deepEqual(overview.failed, [{ name: "graphql", error: "cookie expired" }])
  })
})

describe("fetchCheatersData", () => {
  test("combines flagged users with their details and GitHub submissions", async () => {
    const textTask = (textData) => [
      { previous_submission: { data_json: { itemAnswers: [{ textData }] } } },
    ]
    const clients = fakeClients({
      cheaters: new Map([
        ["u1", { totalDurationSeconds: 150, totalPoints: 30 }],
      ]),
      details: { u1: { name: "Ada", email: "ada@x.fi" } },
      statuses: {
        u1: [
          { exercise: { id: "other" }, exercise_slide_submissions: [{ id: "s0" }] },
          {
            exercise: { id: "gh-exercise" },
            exercise_slide_submissions: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
          },
        ],
      },
      submissions: {
        s0: textTask("should not be shown"),
        s1: textTask(repo),
        s2: textTask(repo),
        s3: textTask("forgot the link"),
      },
    })
    const service = createCourseService(clients)

    const { name, cheaters } = await service.fetchCheatersData({
      name: "graphql",
      exerciseId: "gh-exercise",
      courseId: "course1",
      cheaters: true,
    })

    assert.equal(name, "graphql")
    assert.deepEqual(cheaters, [
      {
        userId: "u1",
        name: "Ada",
        email: "ada@x.fi",
        durationMinutes: 3,
        totalPoints: 30,
        submissions: [repo, "forgot the link"],
      },
    ])
  })
})
