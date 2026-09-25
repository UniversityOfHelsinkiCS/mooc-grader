const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { createInvitationService } = require("../../src/services/invitationService")

function invitation(id, extra = {}) {
  return { id, repo: `student/repo${id}`, url: null, permissions: "write", inviter: "s", createdAt: null, expired: false, ...extra }
}

// Fake accounts client: pending invitations per account index
function fakeAccounts(pending, { logins = ["mluukkai", "grader-bot"], failing = [] } = {}) {
  const calls = []
  const accounts = [
    { index: 0, label: "primary" },
    { index: 1, label: "secondary" },
  ]
  return {
    calls,
    listAccounts: () => accounts,
    findAccount: (index) => accounts.find((account) => account.index === index) ?? null,
    getLogin: async (account) => logins[account.index],
    listInvitations: async (account) => {
      if (failing.includes(account.index)) throw new Error("GitHub 401: Bad credentials")
      return pending[account.index] ?? []
    },
    acceptInvitation: async (account, id) => {
      calls.push(["accept", account.index, id])
      pending[account.index] = pending[account.index].filter((item) => item.id !== id)
    },
    declineInvitation: async (account, id) => {
      calls.push(["decline", account.index, id])
      pending[account.index] = pending[account.index].filter((item) => item.id !== id)
    },
  }
}

describe("invitationService", () => {
  test("summarizes open and expired invitations per account", async () => {
    const accounts = fakeAccounts({
      0: [invitation(1), invitation(2), invitation(3, { expired: true })],
      1: [],
    })
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.fetchSummary(), [
      { index: 0, label: "primary", login: "mluukkai", open: 2, expired: 1 },
      { index: 1, label: "secondary", login: "grader-bot", open: 0, expired: 0 },
    ])
  })

  test("one failing account does not hide the others", async (t) => {
    t.mock.method(console, "error", () => {})
    const accounts = fakeAccounts({ 1: [invitation(7)] }, { failing: [0] })
    const service = createInvitationService({ accounts })

    const [failed, working] = await service.fetchInvitations()

    assert.deepEqual(failed, { index: 0, label: "primary", error: "GitHub 401: Bad credentials" })
    assert.equal(working.invitations.length, 1)
  })

  test("accepts a pending invitation and remembers it, newest first", async () => {
    const accounts = fakeAccounts({ 0: [invitation(1), invitation(2)] })
    let clock = 0
    const service = createInvitationService({
      accounts,
      now: () => new Date(Date.UTC(2026, 8, 25, 10, clock++)),
    })

    assert.deepEqual(await service.accept(0, 1), { ok: true })
    assert.deepEqual(await service.accept(0, 2), { ok: true })

    assert.deepEqual(accounts.calls, [["accept", 0, 1], ["accept", 0, 2]])
    const accepted = service.recentlyAccepted()
    assert.deepEqual(accepted.map((item) => item.repo), ["student/repo2", "student/repo1"])
    assert.equal(accepted[0].account, "primary")
    assert.equal(accepted[0].acceptedAt, "2026-09-25T10:01:00.000Z")
  })

  test("acts only on invitations that are pending for that account", async () => {
    const accounts = fakeAccounts({ 0: [invitation(1)], 1: [invitation(2)] })
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.accept(0, 2), { error: "Invitation not found" })
    assert.deepEqual(await service.accept(9, 1), { error: "Unknown account" })
    assert.deepEqual(await service.decline(1, 1), { error: "Invitation not found" })
    assert.deepEqual(accounts.calls, [])
  })

  test("removes all expired invitations of the account and nothing else", async () => {
    const accounts = fakeAccounts({
      0: [invitation(1), invitation(2, { expired: true }), invitation(3, { expired: true })],
      1: [invitation(4, { expired: true })],
    })
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.declineExpired(0), { ok: true, done: 2, failed: [] })
    assert.deepEqual(accounts.calls, [["decline", 0, 2], ["decline", 0, 3]])
    assert.deepEqual(await service.declineExpired(7), { error: "Unknown account" })
  })

  test("goes on removing when one removal fails", async (t) => {
    t.mock.method(console, "error", () => {})
    const accounts = fakeAccounts({
      0: [invitation(1, { expired: true }), invitation(2, { expired: true })],
    })
    const decline = accounts.declineInvitation
    accounts.declineInvitation = async (account, id) => {
      if (id === 1) throw new Error("GitHub 502")
      return decline(account, id)
    }
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.declineExpired(0), {
      ok: false,
      done: 1,
      failed: [{ repo: "student/repo1", reason: "GitHub 502" }],
    })
  })

  test("accepts all open invitations of the account and remembers them", async () => {
    const accounts = fakeAccounts({
      0: [invitation(1), invitation(2, { expired: true }), invitation(3)],
      1: [invitation(4)],
    })
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.acceptAll(0), { ok: true, done: 2, failed: [] })
    assert.deepEqual(accounts.calls, [["accept", 0, 1], ["accept", 0, 3]])
    assert.deepEqual(
      service.recentlyAccepted().map((item) => item.repo),
      ["student/repo3", "student/repo1"],
    )
    assert.deepEqual(await service.acceptAll(7), { error: "Unknown account" })
  })

  test("accepting all goes on when one fails and remembers only the accepted", async (t) => {
    t.mock.method(console, "error", () => {})
    const accounts = fakeAccounts({ 0: [invitation(1), invitation(2)] })
    const accept = accounts.acceptInvitation
    accounts.acceptInvitation = async (account, id) => {
      if (id === 1) throw new Error("GitHub 502")
      return accept(account, id)
    }
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.acceptAll(0), {
      ok: false,
      done: 1,
      failed: [{ repo: "student/repo1", reason: "GitHub 502" }],
    })
    assert.deepEqual(service.recentlyAccepted().map((item) => item.repo), ["student/repo2"])
  })

  describe("when GitHub reports success but the invitation stays pending", () => {
    // GitHub answered such an accept with 204 while nothing changed
    function ignoringAccepts(pending) {
      const accounts = fakeAccounts(pending)
      accounts.acceptInvitation = async (account, id) => {
        accounts.calls.push(["accept", account.index, id])
      }
      return accounts
    }

    test("a single accept is reported as failed and not remembered", async (t) => {
      t.mock.method(console, "error", () => {})
      const accounts = ignoringAccepts({
        1: [invitation(1, { invitationUrl: "https://github.com/student/repo1/invitations" })],
      })
      const service = createInvitationService({ accounts })

      const result = await service.accept(1, 1)

      assert.equal(
        result.error,
        "GitHub reported success but the invitation is still pending; accept it at https://github.com/student/repo1/invitations while logged in as GitHub user grader-bot. If that page shows 404, the invitation is no longer valid: remove it and ask for a new one",
      )
      assert.deepEqual(service.recentlyAccepted(), [])
    })

    test("names the account by label when its login cannot be read", async (t) => {
      t.mock.method(console, "error", () => {})
      const accounts = ignoringAccepts({ 0: [invitation(1)] })
      accounts.getLogin = async () => {
        throw new Error("GitHub 502")
      }
      const service = createInvitationService({ accounts })

      const { error } = await service.accept(0, 1)

      assert.match(error, /accept it at GitHub's invitation page while logged in as the primary account\./)
    })

    test("accept all counts only the invitations that are really gone", async (t) => {
      t.mock.method(console, "error", () => {})
      const accounts = fakeAccounts({ 0: [invitation(1), invitation(2)] })
      const accept = accounts.acceptInvitation
      accounts.acceptInvitation = async (account, id) => {
        if (id === 2) return // ignored by GitHub
        return accept(account, id)
      }
      const service = createInvitationService({ accounts })

      const result = await service.acceptAll(0)

      assert.equal(result.ok, false)
      assert.equal(result.done, 1)
      assert.deepEqual(result.failed.map(({ repo }) => repo), ["student/repo2"])
      assert.deepEqual(service.recentlyAccepted().map((item) => item.repo), ["student/repo1"])
    })

    test("the invitation is marked until it is accepted or removed", async (t) => {
      t.mock.method(console, "error", () => {})
      const accounts = ignoringAccepts({ 1: [invitation(1), invitation(2)] })
      const service = createInvitationService({ accounts })

      await service.accept(1, 1)
      const marked = (await service.fetchInvitations())[1].invitations
      assert.deepEqual(
        marked.map(({ id, acceptIgnored }) => [id, acceptIgnored]),
        [[1, true], [2, false]],
      )

      assert.deepEqual(await service.decline(1, 1), { ok: true })
      await service.accept(1, 2)
      const [first] = (await service.fetchInvitations())[1].invitations
      assert.equal(first.id, 2)
      assert.equal(first.acceptIgnored, true)
    })

    test("the mark is dropped when GitHub no longer lists the invitation", async (t) => {
      t.mock.method(console, "error", () => {})
      const pending = { 1: [invitation(1)] }
      const accounts = ignoringAccepts(pending)
      const service = createInvitationService({ accounts })

      await service.accept(1, 1)
      pending[1] = [] // e.g. revoked by the student
      await service.fetchInvitations()
      pending[1] = [invitation(1)] // shown again, e.g. an older cached answer

      const [again] = (await service.fetchInvitations())[1].invitations
      assert.equal(again.acceptIgnored, false)
    })

    test("a result that cannot be checked is not reported as done", async (t) => {
      t.mock.method(console, "error", () => {})
      const accounts = fakeAccounts({ 0: [invitation(1)] })
      let lists = 0
      const list = accounts.listInvitations
      accounts.listInvitations = async (account) => {
        if (++lists === 2) throw new Error("GitHub 502")
        return list(account)
      }
      const service = createInvitationService({ accounts })

      const result = await service.accept(0, 1)

      assert.match(result.error, /could not check the result: GitHub 502/)
      assert.deepEqual(service.recentlyAccepted(), [])
    })
  })

  test("an expired invitation can only be removed", async () => {
    const accounts = fakeAccounts({ 0: [invitation(1, { expired: true })] })
    const service = createInvitationService({ accounts })

    assert.deepEqual(await service.accept(0, 1), { error: "Invitation has expired" })
    assert.deepEqual(await service.decline(0, 1), { ok: true })
    assert.deepEqual(accounts.calls, [["decline", 0, 1]])
    assert.deepEqual(service.recentlyAccepted(), [])
  })
})
