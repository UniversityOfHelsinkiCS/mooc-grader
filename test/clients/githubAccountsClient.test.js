const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  createGithubAccountsClient,
  PER_PAGE,
  MAX_PAGES,
} = require("../../src/clients/githubAccountsClient")
const { fakeHttp } = require("../helpers")

const baseUrl = "https://api.github.test"
const credentials = [
  { label: "primary", token: "tok-a" },
  { label: "secondary", token: "tok-b" },
]

const rawInvitation = {
  id: 42,
  repository: { full_name: "student/app", html_url: "https://github.com/student/app" },
  html_url: "https://github.com/student/app/invitations",
  permissions: "write",
  inviter: { login: "student" },
  created_at: "2026-09-25T10:15:00Z",
  expired: false,
}

function client(routes) {
  const http = fakeHttp(routes)
  return { http, accounts: createGithubAccountsClient({ http, baseUrl, credentials }) }
}

describe("githubAccountsClient", () => {
  test("lists the accounts without their tokens", () => {
    const { accounts } = client({})
    assert.deepEqual(accounts.listAccounts(), [
      { index: 0, label: "primary" },
      { index: 1, label: "secondary" },
    ])
    assert.equal(accounts.findAccount(5), null)
  })

  test("lists invitations with the account's own token", async () => {
    const { accounts, http } = client({
      "GET /user/repository_invitations": { status: 200, body: [rawInvitation] },
    })

    const invitations = await accounts.listInvitations(accounts.findAccount(1))

    assert.deepEqual(invitations, [
      {
        id: 42,
        repo: "student/app",
        url: "https://github.com/student/app",
        invitationUrl: "https://github.com/student/app/invitations",
        permissions: "write",
        inviter: "student",
        createdAt: "2026-09-25T10:15:00Z",
        expired: false,
      },
    ])
    assert.equal(http.calls[0].headers.Authorization, "Bearer tok-b")
  })

  test("reads every page of invitations", async () => {
    const invitationsOnPage = (url) => {
      const page = Number(new URL(url).searchParams.get("page"))
      const count = page === 1 || page === 2 ? PER_PAGE : page === 3 ? 7 : 0
      return Array.from({ length: count }, (_, i) => ({ ...rawInvitation, id: page * 1000 + i }))
    }
    const { accounts, http } = client({
      "GET /user/repository_invitations": (url) => ({ status: 200, body: invitationsOnPage(url) }),
    })

    const invitations = await accounts.listInvitations(accounts.findAccount(0))

    assert.equal(invitations.length, 2 * PER_PAGE + 7)
    assert.equal(new Set(invitations.map((i) => i.id)).size, invitations.length)
    assert.deepEqual(
      http.calls.map((call) => new URL(call.url).search),
      [1, 2, 3].map((page) => `?per_page=${PER_PAGE}&page=${page}`),
    )
  })

  test("stops after MAX_PAGES full pages", async () => {
    let id = 0
    const { accounts, http } = client({
      "GET /user/repository_invitations": () => ({
        status: 200,
        body: Array.from({ length: PER_PAGE }, () => ({ ...rawInvitation, id: ++id })),
      }),
    })

    const invitations = await accounts.listInvitations(accounts.findAccount(0))

    assert.equal(http.calls.length, MAX_PAGES)
    assert.equal(invitations.length, MAX_PAGES * PER_PAGE)
  })

  test("keeps only links that point to GitHub", async () => {
    const { accounts } = client({
      "GET /user/repository_invitations": {
        status: 200,
        body: [
          {
            ...rawInvitation,
            html_url: "javascript:alert(1)",
            repository: { full_name: "student/app", html_url: "https://evil.example/student/app" },
          },
        ],
      },
    })

    const [invitation] = await accounts.listInvitations(accounts.findAccount(0))

    assert.equal(invitation.url, null)
    assert.equal(invitation.invitationUrl, null)
    assert.equal(invitation.repo, "student/app")
  })

  test("reads the login of the account", async () => {
    const { accounts } = client({ "GET /user": { status: 200, body: { login: "mluukkai" } } })
    assert.equal(await accounts.getLogin(accounts.findAccount(0)), "mluukkai")
  })

  test("accepts with PATCH and declines with DELETE", async () => {
    const { accounts, http } = client({
      "PATCH /user/repository_invitations/42": { status: 204, body: "" },
      "DELETE /user/repository_invitations/43": { status: 204, body: "" },
    })
    const account = accounts.findAccount(0)

    await accounts.acceptInvitation(account, 42)
    await accounts.declineInvitation(account, 43)

    assert.deepEqual(
      http.calls.map((call) => `${call.method} ${call.url.replace(baseUrl, "")}`),
      ["PATCH /user/repository_invitations/42", "DELETE /user/repository_invitations/43"],
    )
    assert.ok(http.calls.every((call) => call.headers.Authorization === "Bearer tok-a"))
  })

  test("throws GitHub's error message", async () => {
    const { accounts } = client({
      "GET /user/repository_invitations": { status: 401, body: { message: "Bad credentials" } },
    })
    await assert.rejects(
      accounts.listInvitations(accounts.findAccount(0)),
      /GitHub 401: Bad credentials/,
    )
  })
})
