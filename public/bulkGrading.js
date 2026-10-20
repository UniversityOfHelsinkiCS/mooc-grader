// Picking and grading the answers of a tab page, shared by the tab page and
// the overview page, which grades several tab pages at once

// The reset reason matching the first failed check flagged on the Reset
// button, or null when no check is flagged
function resetReasonFor(button) {
  if (button.dataset.repoMissing === "true") return "repository must be accessible by user mluukkai"
  if (button.dataset.ghaFailed === "true") return "tests must pass in GitHub"
  if (button.dataset.qrMissing === "true") return "QR-code missing"
  if (button.dataset.linksMissing === "true") return "README.md does not contain the required links"
  if (button.dataset.prMissing === "true") return "the answer must be a link to a pull request"
  return null
}

// Full points buttons of the correct answers not graded yet on the page
function correctTargets(root = document) {
  return [
    ...root.querySelectorAll('.grade-btn[data-action="FullPoints"][data-correct="true"]'),
  ].filter((button) => !button.classList.contains("grade-btn-selected"))
}

// Reset buttons of the incorrect answers not graded yet on the page whose
// failed check has a reset reason
function incorrectTargets(root = document) {
  return [
    ...root.querySelectorAll('.grade-btn[data-action="Reset"][data-incorrect="true"]'),
  ].filter(
    (button) =>
      !button.closest("td").querySelector(".grade-btn-selected") && resetReasonFor(button),
  )
}

// Sends the grade of the answer of the button: its own action, or a reset
// when a justification is given. Resolves to { ok, message }
async function postGrade(button, justification = null) {
  const body = {
    user_exercise_state_id: button.dataset.userId,
    exercise_id: button.dataset.exerciseId,
    action: justification ? "Other" : button.dataset.action,
    user_id: button.dataset.studentId,
  }
  if (justification) body.justification = justification
  try {
    const response = await fetch(`${basePath}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    const ok = response.ok && data.ok
    return {
      ok,
      message: ok ? null : data?.error || data?.body?.error || ("failed (" + response.status + ")"),
    }
  } catch (err) {
    return { ok: false, message: err.message }
  }
}

// Approve PR buttons of the pull requests not approved yet whose answers
// are not graded yet on the page
function unapprovedPrTargets(root = document) {
  return [
    ...root.querySelectorAll('.grade-btn[data-action="ApprovePr"]:not(.grade-btn-selected)'),
  ].filter((button) => !button.closest("td").querySelector(".grade-btn-selected"))
}

// Approves the pull request of the Approve PR button. Resolves to
// { ok, message } with the approving account as the message on success
async function postApprovePr(button) {
  try {
    const response = await fetch(`${basePath}/approve-pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exercise_id: button.dataset.exerciseId,
        pr_url: button.dataset.prUrl,
        user_id: button.dataset.studentId,
      }),
    })
    const data = await response.json()
    const ok = response.ok && data.ok
    return {
      ok,
      message: ok ? `approved (${data.account})` : data?.error || ("failed (" + response.status + ")"),
    }
  } catch (err) {
    return { ok: false, message: err.message }
  }
}
