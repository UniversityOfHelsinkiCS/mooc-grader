// Path prefix the app is served under, set by the server on <body>
const basePath = document.body.dataset.basePath ?? ""

// A message is kept over the reload that follows an action, so that e.g. a
// partly failed removal is still reported after the page shows what is left
const NOTICE_KEY = "invites-notice"

function saveNotice(message) {
  try {
    sessionStorage.setItem(NOTICE_KEY, message)
  } catch {
    // storage unavailable: the reloaded page just shows the current state
  }
}

function showSavedNotice() {
  let message = null
  try {
    message = sessionStorage.getItem(NOTICE_KEY)
    sessionStorage.removeItem(NOTICE_KEY)
  } catch {
    return
  }
  const notice = document.getElementById("invites-notice")
  if (message && notice) {
    notice.textContent = message
    notice.hidden = false
  }
}

showSavedNotice()

// Actions on all matching invitations of an account, with their confirmations
const BULK_CONFIRMATIONS = {
  "accept-all": (count) => `Accept all ${count} open invitations?`,
  "decline-expired": (count) => `Remove all ${count} expired invitations?`,
}

function requestBody(button) {
  const account = Number(button.dataset.account)
  return button.dataset.action in BULK_CONFIRMATIONS
    ? { account }
    : { account, invitationId: Number(button.dataset.invitationId) }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".invite-btn")
  if (!button) return

  const action = button.dataset.action
  if (action === "decline" && !window.confirm("Remove this invitation?")) return
  const bulkConfirmation = BULK_CONFIRMATIONS[action]
  if (bulkConfirmation && !window.confirm(bulkConfirmation(button.dataset.count))) {
    return
  }

  const result = button.nextElementSibling
  document.querySelectorAll(".invite-btn").forEach((btn) => {
    btn.disabled = true
  })
  if (result) {
    result.textContent = "sending..."
    result.className = "grade-result"
  }

  let response
  try {
    response = await fetch(`${basePath}/invitations/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(button)),
    })
  } catch (err) {
    // the server was not reached, so nothing changed: stay on the page
    if (result) {
      result.textContent = err.message
      result.classList.add("grade-fail")
    }
    document.querySelectorAll(".invite-btn").forEach((btn) => {
      btn.disabled = false
    })
    return
  }

  // Whatever the outcome, reload so that the lists show the current state;
  // a refusal or failure is shown on the reloaded page
  let data = null
  try {
    data = await response.json()
  } catch {
    // not JSON, e.g. a proxy error page
  }
  if (!response.ok || !data?.ok) {
    saveNotice(data?.error || "failed (" + response.status + ")")
  }
  window.location.reload()
})
