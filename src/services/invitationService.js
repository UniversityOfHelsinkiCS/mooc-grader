// Accepted invitations are remembered only in memory, so the list starts
// empty after a restart
const MAX_REMEMBERED = 100

function createInvitationService({ accounts, now = () => new Date() }) {
  const accepted = []
  // Invitations GitHub kept pending after an accept (it answered with
  // success anyway); such an invitation is usually no longer valid, so the
  // page offers removing it. Also only in memory.
  const ignoredAccepts = new Set()
  const ignoredKey = (account, invitationId) => `${account.index}:${invitationId}`

  // Marks of invitations GitHub no longer lists (e.g. revoked by the
  // student) are dropped, so that the set holds only current invitations
  function forgetVanished(account, invitations) {
    const listed = new Set(invitations.map((invitation) => ignoredKey(account, invitation.id)))
    for (const key of ignoredAccepts) {
      if (key.startsWith(`${account.index}:`) && !listed.has(key)) {
        ignoredAccepts.delete(key)
      }
    }
  }

  // { index, label, login, invitations } or { index, label, error }; one
  // account failing (e.g. an expired token) does not hide the others
  async function fetchAccount(account) {
    try {
      const [login, invitations] = await Promise.all([
        accounts.getLogin(account),
        accounts.listInvitations(account),
      ])
      forgetVanished(account, invitations)
      return {
        index: account.index,
        label: account.label,
        login,
        invitations: invitations.map((invitation) => ({
          ...invitation,
          acceptIgnored: ignoredAccepts.has(ignoredKey(account, invitation.id)),
        })),
      }
    } catch (error) {
      console.error(`GitHub ${account.label} account invitations:`, error.message)
      return { index: account.index, label: account.label, error: error.message }
    }
  }

  function fetchInvitations() {
    return Promise.all(
      accounts
        .listAccounts()
        .map((summary) => fetchAccount(accounts.findAccount(summary.index))),
    )
  }

  // Counts for the overview page
  async function fetchSummary() {
    const results = await fetchInvitations()
    return results.map(({ index, label, login, invitations, error }) =>
      error
        ? { index, label, error }
        : {
            index,
            label,
            login,
            open: invitations.filter((invitation) => !invitation.expired).length,
            expired: invitations.filter((invitation) => invitation.expired).length,
          },
    )
  }

  // Only invitations that are currently pending for the account are acted
  // on; an expired invitation cannot be accepted, only removed
  async function findPending(accountIndex, invitationId) {
    const account = accounts.findAccount(accountIndex)
    if (!account) {
      return { error: "Unknown account" }
    }
    const invitations = await accounts.listInvitations(account)
    const invitation = invitations.find((item) => item.id === invitationId)
    if (!invitation) {
      return { error: "Invitation not found" }
    }
    return { account, invitation }
  }

  function remember(account, invitation) {
    accepted.unshift({
      ...invitation,
      account: account.label,
      acceptedAt: now().toISOString(),
    })
    accepted.length = Math.min(accepted.length, MAX_REMEMBERED)
  }

  // Runs action on each invitation, one at a time so that GitHub is not
  // flooded, and checks the result against a fresh list: GitHub has been seen
  // to answer an accept with success (204) while the invitation stays pending,
  // so only invitations that are really gone count as done.
  // Returns { done: [invitation], failed: [{ repo, reason }],
  //   ignored: [invitation] } where ignored are the ones GitHub kept pending
  async function applyAndVerify(account, invitations, action, [verb, imperative]) {
    const attempted = []
    const failed = []
    for (const invitation of invitations) {
      try {
        await action(account, invitation.id)
        attempted.push(invitation)
      } catch (error) {
        console.error(`${verb} invitation to ${invitation.repo}:`, error.message)
        failed.push({ repo: invitation.repo, reason: error.message })
      }
    }
    if (attempted.length === 0) {
      return { done: [], failed, ignored: [] }
    }

    let pendingIds
    try {
      pendingIds = new Set((await accounts.listInvitations(account)).map((item) => item.id))
    } catch (error) {
      const reason = `could not check the result: ${error.message}`
      return {
        done: [],
        failed: [...failed, ...attempted.map(({ repo }) => ({ repo, reason }))],
        ignored: [],
      }
    }

    const ignored = attempted.filter((invitation) => pendingIds.has(invitation.id))
    const done = attempted.filter((invitation) => !pendingIds.has(invitation.id))
    if (ignored.length > 0) {
      // The invitation page on github.com does not accept API tokens, so it
      // has to be opened in a browser logged in as the invited account
      const login = await accounts.getLogin(account).catch(() => null)
      const as = login ? `GitHub user ${login}` : `the ${account.label} account`
      for (const invitation of ignored) {
        const where = invitation.invitationUrl ?? "GitHub's invitation page"
        const reason = `GitHub reported success but the invitation is still pending; ${imperative} it at ${where} while logged in as ${as}. If that page shows 404, the invitation is no longer valid: remove it and ask for a new one`
        console.error(`${verb} invitation to ${invitation.repo}: ${reason}`)
        failed.push({ repo: invitation.repo, reason })
      }
    }
    return { done, failed, ignored }
  }

  async function acceptInvitations(account, invitations) {
    const result = await applyAndVerify(
      account,
      invitations,
      accounts.acceptInvitation,
      ["Accepting", "accept"],
    )
    for (const invitation of result.done) {
      remember(account, invitation)
      ignoredAccepts.delete(ignoredKey(account, invitation.id))
    }
    for (const invitation of result.ignored ?? []) {
      ignoredAccepts.add(ignoredKey(account, invitation.id))
    }
    return result
  }

  async function declineInvitations(account, invitations) {
    const result = await applyAndVerify(account, invitations, accounts.declineInvitation, [
      "Removing",
      "remove",
    ])
    for (const invitation of result.done) {
      ignoredAccepts.delete(ignoredKey(account, invitation.id))
    }
    return result
  }

  // { ok: true } or { error } for a single invitation
  function singleResult({ failed }) {
    return failed.length === 0 ? { ok: true } : { error: failed[0].reason }
  }

  // { ok, done, failed } for all matching invitations of an account
  async function bulk(accountIndex, matches, run) {
    const account = accounts.findAccount(accountIndex)
    if (!account) {
      return { error: "Unknown account" }
    }
    const invitations = (await accounts.listInvitations(account)).filter(matches)
    const { done, failed } = await run(account, invitations)
    return { ok: failed.length === 0, done: done.length, failed }
  }

  async function accept(accountIndex, invitationId) {
    const { error, account, invitation } = await findPending(accountIndex, invitationId)
    if (error) return { error }
    if (invitation.expired) {
      return { error: "Invitation has expired" }
    }
    return singleResult(await acceptInvitations(account, [invitation]))
  }

  async function decline(accountIndex, invitationId) {
    const { error, account, invitation } = await findPending(accountIndex, invitationId)
    if (error) return { error }
    return singleResult(await declineInvitations(account, [invitation]))
  }

  // Accepts every open (not expired) invitation of the account
  function acceptAll(accountIndex) {
    return bulk(accountIndex, (invitation) => !invitation.expired, acceptInvitations)
  }

  // Removes every expired invitation of the account
  function declineExpired(accountIndex) {
    return bulk(accountIndex, (invitation) => invitation.expired, declineInvitations)
  }

  // Newest first
  function recentlyAccepted() {
    return [...accepted]
  }

  return {
    fetchInvitations,
    fetchSummary,
    accept,
    decline,
    acceptAll,
    declineExpired,
    recentlyAccepted,
  }
}

module.exports = { createInvitationService }
