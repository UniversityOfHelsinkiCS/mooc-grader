// Repository invitations of the GitHub accounts behind the configured tokens.
// Students invite an account as a collaborator so that the grader can see
// their private repositories; the invitation has to be accepted first.
//
// Unlike the repository checks these requests are made with one specific
// token and are never cached, so that the lists are always current.

// GitHub answers at most 100 invitations per page; more than MAX_PAGES pages
// are not read so that a misbehaving response cannot keep the loop going
const PER_PAGE = 100
const MAX_PAGES = 10

// Links shown on the page must point to GitHub; anything else is dropped
function githubUrl(value) {
  return typeof value === "string" && value.startsWith("https://github.com/")
    ? value
    : null
}

function toInvitation(invitation) {
  return {
    id: invitation.id,
    repo: invitation.repository?.full_name ?? "(unknown repository)",
    url: githubUrl(invitation.repository?.html_url),
    // GitHub's page for accepting the invitation: until it is accepted a
    // private repository answers 404 even to the invited account
    invitationUrl: githubUrl(invitation.html_url),
    permissions: invitation.permissions ?? null,
    inviter: invitation.inviter?.login ?? null,
    createdAt: invitation.created_at ?? null,
    expired: invitation.expired === true,
  }
}

// credentials: [{ label, token }]
function createGithubAccountsClient({ http, baseUrl, credentials = [] }) {
  const accounts = credentials.map(({ label, token }, index) => ({
    index,
    label,
    token,
  }))

  function headers(account) {
    return {
      "User-Agent": "crawler",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${account.token}`,
    }
  }

  async function call(account, method, path) {
    const url = `${baseUrl}${path}`
    const { status, body } =
      method === "GET"
        ? await http.get(url, headers(account))
        : await http.send(method, url, headers(account))
    if (status >= 400) {
      const message = typeof body === "object" ? body?.message : null
      throw new Error(`GitHub ${status}${message ? `: ${message}` : ""}`)
    }
    return body
  }

  // [{ index, label }] without the tokens
  function listAccounts() {
    return accounts.map(({ index, label }) => ({ index, label }))
  }

  function findAccount(index) {
    return accounts.find((account) => account.index === index) ?? null
  }

  async function getLogin(account) {
    const user = await call(account, "GET", "/user")
    return user?.login ?? null
  }

  // All pending invitations, read page by page until a page is not full
  async function listInvitations(account) {
    const all = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const invitations = await call(
        account,
        "GET",
        `/user/repository_invitations?per_page=${PER_PAGE}&page=${page}`,
      )
      if (!Array.isArray(invitations)) break
      all.push(...invitations.map(toInvitation))
      if (invitations.length < PER_PAGE) break
    }
    return all
  }

  function acceptInvitation(account, invitationId) {
    return call(account, "PATCH", `/user/repository_invitations/${invitationId}`)
  }

  function declineInvitation(account, invitationId) {
    return call(account, "DELETE", `/user/repository_invitations/${invitationId}`)
  }

  return {
    listAccounts,
    findAccount,
    getLogin,
    listInvitations,
    acceptInvitation,
    declineInvitation,
  }
}

module.exports = { createGithubAccountsClient, PER_PAGE, MAX_PAGES }
