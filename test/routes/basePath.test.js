const { test, describe, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { createApp } = require("../../src/app")
const { startServer } = require("../helpers")

const UES = "33333333-3333-4333-8333-333333333333"
const tabs = [
  {
    id: "fullstack",
    name: "Full stack",
    courses: [
      { exerciseId: "ex1", name: "graphql", courseId: "c1", cheaters: true },
    ],
  },
]

// The app behind a proxy that forwards /mooc-grader/... without stripping it
describe("served under a base path", () => {
  let server
  const gradingCalls = []

  before(async () => {
    const courseService = {
      fetchTabOverview: async (tab) => ({
        id: tab.id,
        name: tab.name,
        answerCount: 0,
        cheaterCount: 0,
        failed: [],
      }),
      fetchTabData: async () => [
        {
          exerciseId: "ex1",
          courseId: "c1",
          name: "graphql",
          gha: false,
          qr: false,
          linkCount: null,
          cheaterCount: 2,
          answers: [],
        },
      ],
      fetchCheatersData: async () => ({ name: "graphql", cheaters: [] }),
    }
    const mooc = {
      postGradingDecision: async (payload) => {
        gradingCalls.push(payload)
        return { status: 200, body: {} }
      },
    }
    server = await startServer(
      createApp({
        tabs,
        mooc,
        courseService,
        auth: { allowedUids: ["mluukkai"], enforce: true },
        basePath: "/mooc-grader",
      }),
    )
  })

  after(() => server.close())

  const get = (path, headers = { uid: "mluukkai" }) =>
    fetch(`${server.url}${path}`, { headers })

  test("pages, static files and the API are served under it", async () => {
    for (const path of [
      "/mooc-grader",
      "/mooc-grader/",
      "/mooc-grader/fullstack",
      "/mooc-grader/cheaters/c1",
      "/mooc-grader/static/styles.css",
      "/mooc-grader/static/grading.js",
    ]) {
      assert.equal((await get(path)).status, 200, path)
    }

    const response = await fetch(`${server.url}/mooc-grader/grade`, {
      method: "POST",
      headers: { uid: "mluukkai", "Content-Type": "application/json" },
      body: JSON.stringify({ user_exercise_state_id: UES, exercise_id: "ex1", action: "FullPoints" }),
    })
    assert.equal(response.status, 200)
    assert.equal(gradingCalls.length, 1)
  })

  test("nothing is served outside it", async () => {
    for (const path of ["/", "/fullstack", "/static/styles.css", "/cheaters/c1"]) {
      assert.equal((await get(path)).status, 404, path)
    }
  })

  test("every generated URL carries the base path", async () => {
    const pages = await Promise.all(
      ["/mooc-grader/", "/mooc-grader/fullstack", "/mooc-grader/cheaters/c1"].map(
        async (path) => (await get(path)).text(),
      ),
    )
    const [overview, tab, cheaters] = pages

    assert.ok(overview.includes('<a href="/mooc-grader/fullstack">Full stack</a>'))
    assert.ok(tab.includes('<a href="/mooc-grader/">&larr; Overview</a>'))
    assert.ok(tab.includes('href="/mooc-grader/cheaters/c1"'))
    assert.ok(tab.includes('<script src="/mooc-grader/static/grading.js">'))
    assert.ok(cheaters.includes('<script src="/mooc-grader/static/cheaters.js">'))

    for (const html of pages) {
      assert.ok(html.includes('href="/mooc-grader/static/styles.css"'))
      assert.ok(html.includes('data-base-path="/mooc-grader"'))
      // no link, script or stylesheet points outside the base path
      const urls = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1])
      for (const url of urls) {
        assert.ok(url.startsWith("/mooc-grader/"), url)
      }
    }
  })

  test("security still applies under it", async (t) => {
    t.mock.method(console, "warn", () => {})
    assert.equal((await get("/mooc-grader/fullstack", {})).status, 403)
    const page = await get("/mooc-grader/fullstack")
    assert.equal(page.headers.get("cache-control"), "no-store")
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/)

    const crossSite = await fetch(`${server.url}/mooc-grader/grade`, {
      method: "POST",
      headers: { uid: "mluukkai", "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body: "{}",
    })
    assert.equal(crossSite.status, 403)
  })
})

describe("the browser scripts", () => {
  test("send every request under the base path", () => {
    const fs = require("node:fs")
    const path = require("node:path")
    for (const file of ["grading.js", "cheaters.js"]) {
      const source = fs.readFileSync(path.join(__dirname, "../../public", file), "utf8")
      assert.match(source, /document\.body\.dataset\.basePath/, file)
      // no fetch to a hard-coded absolute path
      assert.doesNotMatch(source, /fetch\(\s*["']\//, file)
    }
  })
})
