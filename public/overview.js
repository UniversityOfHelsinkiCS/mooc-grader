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

// Accepts the open invitations of every account, one account at a time,
// then reloads the account rows so that the counts are current
const acceptAllInvites = document.getElementById("accept-all-invites")
if (acceptAllInvites) {
  acceptAllInvites.addEventListener("click", async () => {
    if (!window.confirm("Accept all open invitations of every account?")) return

    const summary = document.getElementById("accept-all-invites-result")
    const accounts = acceptAllInvites.dataset.accounts.split(",").map(Number)
    acceptAllInvites.disabled = true
    summary.className = "grade-result"
    summary.textContent = "accepting..."

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

    acceptAllInvites.disabled = false
    summary.textContent =
      errors.length === 0 ? `${accepted} accepted` : `${accepted} accepted; ${errors.join("; ")}`
    summary.classList.add(errors.length === 0 ? "grade-ok" : "grade-fail")

    const rows = document.querySelectorAll("#invites-summary tbody tr")
    accounts.forEach((account, index) => {
      if (rows[index]) loadRow(rows[index], `${basePath}/overview/invites/${account}`)
    })
  })
}
