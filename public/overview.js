// The overview page arrives with placeholder rows; each one is replaced with
// its row from the server as soon as that has been counted

function showError(row, message) {
  for (const spinner of row.querySelectorAll(".spinner")) {
    spinner.remove()
  }
  const note = document.createElement("p")
  note.className = "load-error"
  note.textContent = `Could not load: ${message}`
  row.cells[0].append(note)
}

async function loadRow(row, url = row.dataset.rowUrl) {
  try {
    const response = await fetch(url)
    const body = await response.text()
    if (!response.ok) {
      throw new Error(body || `HTTP ${response.status}`)
    }
    row.outerHTML = body
  } catch (err) {
    showError(row, err.message)
  }
}

document.querySelectorAll("tr[data-row-url]").forEach((row) => loadRow(row))

// Path prefix the app is served under, set by the server on <body>
const basePath = document.body.dataset.basePath ?? ""

// Accepts the open invitations of the accounts, one account at a time.
// Resolves to { accepted, errors }
async function acceptInvitations(accounts) {
  let accepted = 0
  const errors = []
  for (const account of accounts) {
    try {
      const response = await fetch(`${basePath}/invitations/accept-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account }),
      })
      const data = await response.json()
      accepted += data.done ?? 0
      if (!response.ok) errors.push(data.error || `failed (${response.status})`)
    } catch (err) {
      errors.push(err.message)
    }
  }
  return { accepted, errors }
}

// Reloads the account rows so that the counts are current
function reloadInviteRows(accounts) {
  const rows = document.querySelectorAll("#invites-summary tbody tr")
  accounts.forEach((account, index) => {
    if (rows[index]) loadRow(rows[index], `${basePath}/overview/invites/${account}`)
  })
}

// Accounts of the "Accept all" invitations button, none without the button
const acceptAllInvites = document.getElementById("accept-all-invites")
const invitationAccounts = acceptAllInvites
  ? acceptAllInvites.dataset.accounts.split(",").map(Number)
  : []

if (acceptAllInvites) {
  acceptAllInvites.addEventListener("click", async () => {
    if (!window.confirm("Accept all open invitations of every account?")) return

    const summary = document.getElementById("accept-all-invites-result")
    acceptAllInvites.disabled = true
    summary.className = "grade-result"
    summary.textContent = "accepting..."

    const { accepted, errors } = await acceptInvitations(invitationAccounts)

    acceptAllInvites.disabled = false
    summary.textContent =
      errors.length === 0 ? `${accepted} accepted` : `${accepted} accepted; ${errors.join("; ")}`
    summary.classList.add(errors.length === 0 ? "grade-ok" : "grade-fail")
    reloadInviteRows(invitationAccounts)
  })
}

// Grades the tabs of the button like their own "Full points to correct,
// reset incorrect" buttons. Open invitations are accepted first so that no
// answer is reset only because its repository invitation was pending. Then
// loads the tab pages, offers approving the pull requests waiting for
// approval, grades the answers one at a time so that mooc.fi is not
// flooded, and reloads the tab rows
const gradeAllTabs = document.getElementById("grade-all-tabs")
if (gradeAllTabs) {
  gradeAllTabs.addEventListener("click", async () => {
    const summary = document.getElementById("grade-all-tabs-result")
    const tabIds = gradeAllTabs.dataset.tabs.split(",")
    gradeAllTabs.disabled = true
    summary.className = "grade-result"

    let invitations = ""
    let invitationsFailed = ""
    if (invitationAccounts.length > 0) {
      summary.textContent = "accepting invitations..."
      const { accepted, errors } = await acceptInvitations(invitationAccounts)
      invitations =
        `${accepted} invitations accepted` + (errors.length === 0 ? "" : ` (${errors.join("; ")})`)
      if (errors.length > 0) {
        invitationsFailed = `Accepting invitations failed (${errors.join("; ")}), so answers with an inaccessible repository may be reset. `
      }
      reloadInviteRows(invitationAccounts)
    }

    const parser = new DOMParser()
    const correct = []
    const incorrect = []
    const unapproved = []
    const loadErrors = []
    for (const tabId of tabIds) {
      summary.textContent = `loading ${tabId}...`
      try {
        const response = await fetch(`${basePath}/${encodeURIComponent(tabId)}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const page = parser.parseFromString(await response.text(), "text/html")
        correct.push(...correctTargets(page))
        incorrect.push(...incorrectTargets(page))
        unapproved.push(...unapprovedPrTargets(page))
      } catch (err) {
        loadErrors.push(`${tabId} (${err.message})`)
      }
    }
    const notLoaded = loadErrors.length > 0 ? `Could not load: ${loadErrors.join(", ")}. ` : ""

    // An approved pull request gets full points like a correct answer
    const approve =
      unapproved.length > 0 &&
      window.confirm(
        `${notLoaded}${unapproved.length} pull requests are not approved yet. Approve them and give them full points first? Cancel leaves them as they are.`,
      )
    const grade =
      correct.length + incorrect.length > 0 &&
      window.confirm(
        `${notLoaded}${invitationsFailed}Give full points to ${correct.length} correct answers and reset ${incorrect.length} incorrect answers?`,
      )
    const toApprove = approve ? unapproved : []
    const toAccept = grade ? correct : []
    const toReset = grade ? incorrect : []
    const total = toApprove.length + toAccept.length + toReset.length
    if (total === 0) {
      gradeAllTabs.disabled = false
      summary.textContent = `${invitations ? `${invitations}; ` : ""}${notLoaded}nothing graded`
      if (loadErrors.length > 0) summary.classList.add("grade-fail")
      return
    }

    let approved = 0
    let accepted = 0
    let reset = 0
    let failed = 0
    const progress = () => `sending ${approved + accepted + reset + failed + 1}/${total}...`
    for (const button of toApprove) {
      summary.textContent = progress()
      const fullPoints = button.closest("td").querySelector('.grade-btn[data-action="FullPoints"]')
      if ((await postApprovePr(button)).ok && fullPoints && (await postGrade(fullPoints)).ok) {
        approved++
      } else {
        failed++
      }
    }
    for (const button of toAccept) {
      summary.textContent = progress()
      if ((await postGrade(button)).ok) {
        accepted++
      } else {
        failed++
      }
    }
    for (const button of toReset) {
      summary.textContent = progress()
      if ((await postGrade(button, resetReasonFor(button))).ok) {
        reset++
      } else {
        failed++
      }
    }

    gradeAllTabs.disabled = false
    summary.textContent =
      (invitations ? `${invitations}, ` : "") +
      (toApprove.length > 0 ? `${approved} pull requests approved, ` : "") +
      `${accepted} given full points, ${reset} reset` +
      (failed === 0 ? "" : `, ${failed} failed`) +
      (loadErrors.length === 0 ? "" : `; could not load: ${loadErrors.join(", ")}`)
    summary.classList.add(failed === 0 && loadErrors.length === 0 ? "grade-ok" : "grade-fail")

    for (const tabId of tabIds) {
      const link = document.querySelector(
        `#tab-summary a[href="${basePath}/${encodeURIComponent(tabId)}"]`,
      )
      const row = link?.closest("tr")
      if (row) loadRow(row, `${basePath}/overview/tabs/${encodeURIComponent(tabId)}`)
    }
  })
}
