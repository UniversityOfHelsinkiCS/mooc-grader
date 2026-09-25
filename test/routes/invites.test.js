const { test, describe, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { createApp } = require("../../src/app")
const { startServer } = require("../helpers")

describe("invitations pages and API", () => {
  let server
  const serviceCalls = []

  before(async () => {
    const accounts = [
      {
        index: 0,
        label: "primary",
        login: "mluukkai",
        invitations: [
          {
            id: 42,
            repo: "student/<b>app</b>",
            url: "https://github.com/student/app",
            invitationUrl: "https://github.com/student/app/invitations",
            permissions: "write",
            inviter: "student",
            createdAt: "2026-09-25T10:15:00Z",
            expired: false,
          },
          {
            id: 44,
            repo: "student/ghost",
            url: "https://github.com/student/ghost",
            invitationUrl: "https://github.com/student/ghost/invitations",
            permissions: "write",
            inviter: "student",
            createdAt: null,
            expired: false,
            acceptIgnored: true,
          },
          {
            id: 43,
            repo: "student/old",
            url: null,
            permissions: "read",
            inviter: null,
            createdAt: null,
            expired: true,
          },
        ],
      },
      { index: 1, label: "secondary", error: "GitHub 401: Bad credentials" },
    ]
    const invitationService = {
      fetchInvitations: async () => accounts,
      fetchSummary: async () => [
        { index: 0, label: "primary", login: "mluukkai", open: 1, expired: 1 },
        { index: 1, label: "secondary", error: "GitHub 401: Bad credentials" },
      ],
      recentlyAccepted: () => [
        { repo: "student/done", url: null, account: "primary", acceptedAt: "2026-09-25T09:00:00.000Z" },
      ],
      accept: async (account, id) => {
        serviceCalls.push(["accept", account, id])
        return id === 42 ? { ok: true } : { error: "Invitation not found" }
      },
      declineExpired: async (account) => {
        serviceCalls.push(["declineExpired", account])
        return account === 0
          ? { ok: true, done: 1, failed: [] }
          : { ok: false, done: 2, failed: [{ repo: "student/x", reason: "GitHub 502" }] }
      },
      acceptAll: async (account) => {
        serviceCalls.push(["acceptAll", account])
        return account === 0
          ? { ok: true, done: 1, failed: [] }
          : { ok: false, done: 0, failed: [{ repo: "student/y", reason: "still pending" }] }
      },
      decline: async (account, id) => {
        serviceCalls.push(["decline", account, id])
        if (id === 500) throw new Error("GitHub 502")
        return { ok: true }
      },
    }
    const courseService = {
      fetchTabOverview: async (tab) => ({ id: tab.id, name: tab.name, answerCount: 0, cheaterCount: 0, failed: [] }),
    }
    server = await startServer(
      createApp({
        tabs: [{ id: "t", name: "T", courses: [] }],
        mooc: {},
        courseService,
        invitationService,
        auth: { allowedUids: ["mluukkai"], enforce: true },
        basePath: "/mooc-grader",
      }),
    )
  })

  after(() => server.close())

  const get = (path) => fetch(`${server.url}/mooc-grader${path}`, { headers: { uid: "mluukkai" } })
  const post = (path, body, headers = {}) =>
    fetch(`${server.url}/mooc-grader${path}`, {
      method: "POST",
      headers: { uid: "mluukkai", "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

  test("the overview shows a summary per account linking to the page", async () => {
    const html = await (await get("/")).text()
    assert.ok(html.includes('<a href="/mooc-grader/invites">GitHub invitations</a>'))
    assert.ok(html.includes("<td>mluukkai <small>(primary)</small></td><td>1</td><td>1</td>"))
    assert.ok(html.includes("Could not load: GitHub 401: Bad credentials"))
  })

  test("the page lists invitations with the right action and escapes GitHub data", async () => {
    const html = await (await get("/invites")).text()
    assert.ok(html.includes("student/&lt;b&gt;app&lt;/b&gt;"))
    assert.ok(!html.includes("<b>app</b>"))
    assert.ok(html.includes('data-action="accept" data-account="0" data-invitation-id="42">Accept<'))
    assert.ok(html.includes('data-action="decline" data-account="0" data-invitation-id="43">Remove<'))
    assert.ok(html.includes("2026-09-25 10:15 UTC"))
    // pending invitations link to GitHub's invitation page, not the private repo
    assert.ok(html.includes('<a href="https://github.com/student/app/invitations"'))
    assert.ok(!html.includes('<a href="https://github.com/student/app"'))
    assert.ok(html.includes("Accepted since last restart"))
    assert.ok(html.includes('<script src="/mooc-grader/static/invites.js">'))
    // the script shows the outcome of the previous action here after reloading
    assert.ok(html.includes('<p id="invites-notice" class="load-error" hidden></p>'))
    assert.ok(html.includes("Could not load: GitHub 401: Bad credentials"))
  })

  test("an invitation GitHub kept pending after accepting offers Remove and its page", async () => {
    const html = await (await get("/invites")).text()
    const row = html.match(/<tr><td><a href="https:\/\/github.com\/student\/ghost\/invitations".*?<\/tr>/)[0]
    assert.ok(row.includes("GitHub kept this pending after it was accepted"))
    assert.ok(row.includes('>invitation page</a>'))
    assert.ok(row.includes('data-action="accept" data-account="0" data-invitation-id="44">Accept<'))
    assert.ok(row.includes('data-action="decline" data-account="0" data-invitation-id="44">Remove<'))

    // an ordinary open invitation still only offers Accept
    const normal = html.match(/<tr><td><a href="https:\/\/github.com\/student\/app\/invitations".*?<\/tr>/)[0]
    assert.ok(!normal.includes('data-action="decline"'))
    assert.ok(!normal.includes("GitHub kept this pending"))
  })

  test("accept and decline go to the service", async () => {
    serviceCalls.length = 0
    assert.deepEqual(await (await post("/invitations/accept", { account: 0, invitationId: 42 })).json(), { ok: true })
    assert.deepEqual(await (await post("/invitations/decline", { account: 0, invitationId: 43 })).json(), { ok: true })
    assert.deepEqual(serviceCalls, [["accept", 0, 42], ["decline", 0, 43]])
  })

  test("the page offers accepting all open and removing all expired invitations", async () => {
    const html = await (await get("/invites")).text()
    assert.ok(
      html.includes('data-action="accept-all" data-account="0" data-count="2">Accept all open (2)<'),
    )
    assert.ok(
      html.includes('data-action="decline-expired" data-account="0" data-count="1">Remove all expired (1)<'),
    )
  })

  test("accept all goes to the service and reports failures", async () => {
    serviceCalls.length = 0
    const done = await post("/invitations/accept-all", { account: 0 })
    assert.equal(done.status, 200)
    const partial = await post("/invitations/accept-all", { account: 1 })
    assert.equal(partial.status, 502)
    assert.equal((await partial.json()).error, "0 accepted, 1 failed: student/y (still pending)")
    const invalid = await post("/invitations/accept-all", { account: "x" })
    assert.equal(invalid.status, 400)
    assert.deepEqual(serviceCalls, [["acceptAll", 0], ["acceptAll", 1]])
  })

  test("remove all expired goes to the service and reports partial failures", async () => {
    serviceCalls.length = 0
    const done = await post("/invitations/decline-expired", { account: 0 })
    assert.equal(done.status, 200)
    assert.deepEqual(await done.json(), { ok: true, done: 1, failed: [] })

    const partial = await post("/invitations/decline-expired", { account: 1 })
    assert.equal(partial.status, 502)
    assert.equal((await partial.json()).error, "2 removed, 1 failed: student/x (GitHub 502)")

    for (const body of [{}, { account: "0" }, { account: -1 }]) {
      const response = await post("/invitations/decline-expired", body)
      assert.equal(response.status, 400, JSON.stringify(body))
    }
    assert.deepEqual(serviceCalls, [["declineExpired", 0], ["declineExpired", 1]])
  })

  test("service refusals and GitHub failures are reported", async () => {
    const refused = await post("/invitations/accept", { account: 0, invitationId: 7 })
    assert.equal(refused.status, 400)
    assert.equal((await refused.json()).error, "Invitation not found")

    const failed = await post("/invitations/decline", { account: 0, invitationId: 500 })
    assert.equal(failed.status, 502)
  })

  test("invalid ids are rejected before the service is called", async () => {
    serviceCalls.length = 0
    for (const body of [
      { account: 0, invitationId: "42" },
      { account: -1, invitationId: 42 },
      { account: 0, invitationId: 0 },
      { account: 0, invitationId: 1.5 },
      { account: 0 },
    ]) {
      const response = await post("/invitations/accept", body)
      assert.equal(response.status, 400, JSON.stringify(body))
    }
    assert.deepEqual(serviceCalls, [])
  })

  test("cross-site requests and forms are rejected", async (t) => {
    t.mock.method(console, "warn", () => {})
    serviceCalls.length = 0
    const crossSite = await post("/invitations/accept", { account: 0, invitationId: 42 }, { "Sec-Fetch-Site": "cross-site" })
    assert.equal(crossSite.status, 403)
    const form = await post("/invitations/accept", "account=0&invitationId=42", { "Content-Type": "application/x-www-form-urlencoded" })
    assert.equal(form.status, 415)
    assert.deepEqual(serviceCalls, [])
  })

  test("the page is not available without an allowed uid", async (t) => {
    t.mock.method(console, "warn", () => {})
    const response = await fetch(`${server.url}/mooc-grader/invites`)
    assert.equal(response.status, 403)
  })
})
