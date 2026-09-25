const { escapeHtml, externalLink, layout } = require("./html")

// "2026-09-25T10:15:00Z" -> "2026-09-25 10:15 UTC"
function formatTime(iso) {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function accountName({ label, login }) {
  return login ? `${escapeHtml(login)} <small>(${escapeHtml(label)})</small>` : escapeHtml(label)
}

function repoLink(invitation, url = invitation.url) {
  return url ? externalLink(url, escapeHtml(invitation.repo)) : escapeHtml(invitation.repo)
}

function button(account, invitation, action, label, cssClass) {
  return `<button class="grade-btn ${cssClass} invite-btn" data-action="${action}" data-account="${account.index}" data-invitation-id="${escapeHtml(invitation.id)}">${label}</button><span class="grade-result"></span>`
}

// Open: Accept. Expired: Remove. Open but kept pending by GitHub after an
// accept: Accept again or Remove
function actionButtons(account, invitation) {
  const accept = button(account, invitation, "accept", "Accept", "grade-btn-green")
  const remove = button(account, invitation, "decline", "Remove", "grade-btn-zero")
  if (invitation.expired) return remove
  return invitation.acceptIgnored ? `${accept} ${remove}` : accept
}

function acceptIgnoredNote(invitation) {
  if (!invitation.acceptIgnored) return ""
  const page = invitation.invitationUrl
    ? externalLink(invitation.invitationUrl, "invitation page")
    : "invitation page"
  return `<br><span class="load-error">GitHub kept this pending after it was accepted. Check the ${page} while logged in as the invited account: if it shows 404, the invitation is no longer valid, so remove it and ask for a new one.</span>`
}

function renderInvitationRow(account, invitation) {
  const expired = invitation.expired ? ` <span class="badge gha-neutral">expired</span>` : ""
  // a pending invitation links to its invitation page, the repository itself
  // is not visible yet if it is private
  const link = repoLink(invitation, invitation.invitationUrl ?? invitation.url)
  return `<tr><td>${link}${expired}${acceptIgnoredNote(invitation)}</td><td>${escapeHtml(invitation.permissions ?? "")}</td><td>${escapeHtml(invitation.inviter ?? "")}</td><td>${formatTime(invitation.createdAt)}</td><td>${actionButtons(account, invitation)}</td></tr>`
}

function renderAccount(account) {
  const heading = `<h2>${accountName(account)}</h2>`
  if (account.error) {
    return `${heading}<p class="load-error">Could not load: ${escapeHtml(account.error)}</p>`
  }
  if (account.invitations.length === 0) {
    return `${heading}<p class="none">No open invitations.</p>`
  }
  const rows = account.invitations
    .map((invitation) => renderInvitationRow(account, invitation))
    .join("")
  const expiredCount = account.invitations.filter((invitation) => invitation.expired).length
  const openCount = account.invitations.length - expiredCount
  const bulkButton = (action, cssClass, label, count) =>
    count > 0
      ? `<button class="grade-btn ${cssClass} invite-btn" data-action="${action}" data-account="${account.index}" data-count="${count}">${label} (${count})</button><span class="grade-result"></span> `
      : ""
  const bulkActions =
    openCount > 0 || expiredCount > 0
      ? `<p>${bulkButton("accept-all", "grade-btn-green", "Accept all open", openCount)}${bulkButton("decline-expired", "grade-btn-zero", "Remove all expired", expiredCount)}</p>`
      : ""
  return `${heading}${bulkActions}<table><thead><tr><th>Repository</th><th>Permissions</th><th>Invited by</th><th>Invited at</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`
}

function renderAccepted(accepted) {
  if (accepted.length === 0) return ""
  const rows = accepted
    .map(
      (invitation) =>
        `<tr><td>${repoLink(invitation)}</td><td>${escapeHtml(invitation.account)}</td><td>${formatTime(invitation.acceptedAt)}</td></tr>`,
    )
    .join("")
  return `<h2>Accepted since last restart</h2><table><thead><tr><th>Repository</th><th>Account</th><th>Accepted at</th></tr></thead><tbody>${rows}</tbody></table>`
}

// accounts: results of invitationService.fetchInvitations()
function renderInvitesPage(accounts, accepted, { basePath = "" } = {}) {
  const content =
    accounts.length === 0
      ? `<p class="none">No GitHub token configured.</p>`
      : accounts.map(renderAccount).join("")
  return layout({
    title: "GitHub invitations",
    basePath,
    body: `<p><a href="${escapeHtml(basePath)}/">&larr; Overview</a></p><h1>GitHub invitations</h1><p id="invites-notice" class="load-error" hidden></p>${content}${renderAccepted(accepted)}
  <script src="${escapeHtml(basePath)}/static/invites.js"></script>`,
  })
}

// Section of the overview page; summary: invitationService.fetchSummary()
function renderInvitesSummary(summary, basePath) {
  const rows =
    summary.length === 0
      ? `<tr><td colspan="3" class="none">No GitHub token configured</td></tr>`
      : summary
          .map((account) =>
            account.error
              ? `<tr><td>${accountName(account)}</td><td colspan="2" class="load-error">Could not load: ${escapeHtml(account.error)}</td></tr>`
              : `<tr><td>${accountName(account)}</td><td>${account.open}</td><td>${account.expired}</td></tr>`,
          )
          .join("")
  return `<h2><a href="${escapeHtml(basePath)}/invites">GitHub invitations</a></h2>
<table><thead><tr><th>Account</th><th>Open</th><th>Expired</th></tr></thead><tbody>${rows}</tbody></table>`
}

module.exports = { renderInvitesPage, renderInvitesSummary }
