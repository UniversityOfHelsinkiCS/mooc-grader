// Path prefix the app is served under, set by the server on <body>
const basePath = document.body.dataset.basePath ?? ""

let pendingReset = null

function openResetModal(button) {
  pendingReset = { button }
  const select = document.getElementById("reset-reason-select")
  const textarea = document.getElementById("reset-reason-text")
  select.value = resetReasonFor(button) ?? select.options[0].value
  textarea.value = ""
  textarea.hidden = true
  document.getElementById("reset-modal-overlay").hidden = false
}

function closeResetModal() {
  pendingReset = null
  document.getElementById("reset-modal-overlay").hidden = true
}

document.getElementById("reset-reason-select").addEventListener("change", (event) => {
  document.getElementById("reset-reason-text").hidden = event.target.value !== "__other__"
})

document.getElementById("reset-modal-cancel").addEventListener("click", () => {
  closeResetModal()
})

// Resets the answer of the Reset button with the justification and shows
// the outcome in its row; resolves to whether it succeeded
async function sendReset(button, justification) {
  const actionCell = button.closest("td")
  const result = actionCell?.querySelector(".grade-result")
  const buttons = actionCell ? actionCell.querySelectorAll(".grade-btn") : [button]

  buttons.forEach((btn) => {
    btn.disabled = true
  })
  if (result) {
    result.textContent = "sending..."
    result.className = "grade-result"
  }

  const { ok, message } = await postGrade(button, justification)
  buttons.forEach((btn) => {
    btn.disabled = false
  })

  if (result) {
    result.textContent = ok ? "reset" : message
    result.classList.add(ok ? "grade-ok" : "grade-fail")
  }
  if (ok) {
    buttons.forEach((btn) => {
      btn.classList.remove("grade-btn-selected")
    })
    button.classList.add("grade-btn-selected")
  }
  return ok
}

document.getElementById("reset-modal-submit").addEventListener("click", async () => {
  if (!pendingReset) return
  const select = document.getElementById("reset-reason-select")
  const textarea = document.getElementById("reset-reason-text")
  const justification = select.value === "__other__" ? textarea.value.trim() : select.value
  if (!justification) {
    textarea.focus()
    return
  }

  const { button } = pendingReset
  closeResetModal()
  await sendReset(button, justification)
})

// Sends a Full points / Zero points grade for the answer of the button and
// shows the outcome in its row; resolves to whether it succeeded
async function sendGrade(button) {
  const actionCell = button.closest("td")
  const result = actionCell?.querySelector(".grade-result")
  const buttons = actionCell ? actionCell.querySelectorAll(".grade-btn") : [button]

  buttons.forEach((btn) => {
    btn.disabled = true
  })
  if (result) {
    result.textContent = "sending..."
    result.className = "grade-result"
  }

  const { ok, message } = await postGrade(button)
  buttons.forEach((btn) => {
    btn.disabled = false
  })

  if (result) {
    result.textContent = ok ? "ok" : message
    result.classList.add(ok ? "grade-ok" : "grade-fail")
  }
  if (ok) {
    buttons.forEach((btn) => {
      btn.classList.remove("grade-btn-selected")
    })
    button.classList.add("grade-btn-selected")
  }
  return ok
}

// Submits an approving review of the answer's pull request on GitHub and,
// once it is approved, gives the answer full points
async function approvePullRequest(button) {
  if (!window.confirm(`Approve ${button.dataset.prUrl} and give full points?`)) return

  const actionCell = button.closest("td")
  const result = actionCell?.querySelector(".grade-result")
  button.disabled = true
  if (result) {
    result.textContent = "approving..."
    result.className = "grade-result"
  }

  const { ok, message } = await postApprovePr(button)
  button.disabled = false

  if (!ok) {
    // Points are not given for a pull request that was not approved
    if (result) {
      result.textContent = message
      result.classList.add("grade-fail")
    }
    return
  }

  const fullPointsButton = actionCell?.querySelector('.grade-btn[data-action="FullPoints"]')
  const graded = fullPointsButton ? await sendGrade(fullPointsButton) : false
  button.classList.add("grade-btn-selected")
  if (result) {
    result.textContent = graded
      ? `${message}, full points given`
      : `${message}, but full points failed: ${result.textContent}`
    result.className = `grade-result ${graded ? "grade-ok" : "grade-fail"}`
  }
}

// Full points to every correct answer not graded yet on this page, one at
// a time so that mooc.fi is not flooded
const acceptCorrectButton = document.getElementById("accept-correct")
if (acceptCorrectButton) {
  acceptCorrectButton.addEventListener("click", async () => {
    const targets = correctTargets()
    const summary = document.getElementById("accept-correct-result")
    if (targets.length === 0) {
      summary.textContent = "no correct answers left"
      summary.className = "grade-result"
      return
    }
    if (!window.confirm(`Give full points to ${targets.length} correct answers?`)) return

    acceptCorrectButton.disabled = true
    summary.className = "grade-result"
    let done = 0
    let failed = 0
    for (const button of targets) {
      summary.textContent = `sending ${done + failed + 1}/${targets.length}...`
      if (await sendGrade(button)) {
        done++
      } else {
        failed++
      }
    }
    acceptCorrectButton.disabled = false
    summary.textContent = failed === 0 ? `${done} given full points` : `${done} given full points, ${failed} failed`
    summary.classList.add(failed === 0 ? "grade-ok" : "grade-fail")
  })
}

// Marks every flagged user of the tab's courses honest; the server goes
// through them one at a time
const allHonestButton = document.getElementById("all-honest")
if (allHonestButton) {
  allHonestButton.addEventListener("click", async () => {
    const count = allHonestButton.dataset.count
    if (!window.confirm(`Mark all ${count} flagged users of this tab honest?`)) return

    const summary = document.getElementById("all-honest-result")
    allHonestButton.disabled = true
    summary.className = "grade-result"
    summary.textContent = "sending..."
    let ok = false
    let message
    try {
      const response = await fetch(`${basePath}/dismiss-all-cheaters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab_id: allHonestButton.dataset.tabId }),
      })
      const data = await response.json()
      ok = response.ok && data.ok
      message = ok ? `${data.done} marked honest` : data?.error || ("failed (" + response.status + ")")
    } catch (err) {
      message = err.message
    }
    allHonestButton.disabled = false
    summary.textContent = message
    summary.classList.add(ok ? "grade-ok" : "grade-fail")
  })
}

// Resets every incorrect answer not graded yet on this page with the reason
// of its failed check, one at a time so that mooc.fi is not flooded
const rejectIncorrectButton = document.getElementById("reject-incorrect")
if (rejectIncorrectButton) {
  rejectIncorrectButton.addEventListener("click", async () => {
    const targets = incorrectTargets()
    const summary = document.getElementById("reject-incorrect-result")
    if (targets.length === 0) {
      summary.textContent = "no incorrect answers left"
      summary.className = "grade-result"
      return
    }
    if (!window.confirm(`Reset ${targets.length} incorrect answers with the reason of their failed check?`)) return

    rejectIncorrectButton.disabled = true
    summary.className = "grade-result"
    let done = 0
    let failed = 0
    for (const button of targets) {
      summary.textContent = `sending ${done + failed + 1}/${targets.length}...`
      if (await sendReset(button, resetReasonFor(button))) {
        done++
      } else {
        failed++
      }
    }
    rejectIncorrectButton.disabled = false
    summary.textContent = failed === 0 ? `${done} reset` : `${done} reset, ${failed} failed`
    summary.classList.add(failed === 0 ? "grade-ok" : "grade-fail")
  })
}

// Full points to every correct answer and resets every incorrect one, one
// at a time so that mooc.fi is not flooded
const gradeAllButton = document.getElementById("grade-all")
if (gradeAllButton) {
  gradeAllButton.addEventListener("click", async () => {
    const correct = correctTargets()
    const incorrect = incorrectTargets()
    const summary = document.getElementById("grade-all-result")
    const total = correct.length + incorrect.length
    if (total === 0) {
      summary.textContent = "no answers left"
      summary.className = "grade-result"
      return
    }
    if (
      !window.confirm(
        `Give full points to ${correct.length} correct answers and reset ${incorrect.length} incorrect answers?`,
      )
    ) {
      return
    }

    gradeAllButton.disabled = true
    summary.className = "grade-result"
    let accepted = 0
    let reset = 0
    let failed = 0
    const progress = () => `sending ${accepted + reset + failed + 1}/${total}...`
    for (const button of correct) {
      summary.textContent = progress()
      if (await sendGrade(button)) {
        accepted++
      } else {
        failed++
      }
    }
    for (const button of incorrect) {
      summary.textContent = progress()
      if (await sendReset(button, resetReasonFor(button))) {
        reset++
      } else {
        failed++
      }
    }
    gradeAllButton.disabled = false
    summary.textContent =
      `${accepted} given full points, ${reset} reset` + (failed === 0 ? "" : `, ${failed} failed`)
    summary.classList.add(failed === 0 ? "grade-ok" : "grade-fail")
  })
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".grade-btn")
  if (!button || !button.dataset.action) return

  const userExerciseStateId = button.dataset.userId
  const itemId = button.dataset.itemId
  const exerciseId = button.dataset.exerciseId
  const action = button.dataset.action
  const grade = button.dataset.grade
  const tabId = button.dataset.tabId

  if (action === "Reset") {
    openResetModal(button)
    return
  }

  if (action === "ApprovePr") {
    await approvePullRequest(button)
    return
  }

  if (action === "ZeroPoints") {
    const confirmed = window.confirm("Set this submission to zero points?")
    if (!confirmed) return
  }

  if (action === "Completion") {
    if (grade === "") {
      const result = button.closest("td")?.querySelector(".grade-result")
      if (result) {
        result.textContent = "course points unknown, completion not sent"
        result.className = "grade-result grade-fail"
      }
      return
    }
    const confirmed = window.confirm("Submit completion for this user?")
    if (!confirmed) return
  }

  if (action !== "Completion") {
    await sendGrade(button)
    return
  }

  // Completion: the completion is submitted first, then full points
  const actionCell = button.closest("td")
  const result = actionCell?.querySelector(".grade-result")
  const buttons = actionCell ? actionCell.querySelectorAll(".grade-btn") : [button]

  buttons.forEach((btn) => {
    btn.disabled = true
  })
  if (!result) return
  result.textContent = "sending..."
  result.className = "grade-result"

  try {
    let allOk = true

    console.log("Completion button clicked", { userExerciseStateId, itemId, exerciseId, grade })
    // First, submit completion
    const today = new Date()
    const completionDate = today.toISOString().replace('Z', '+00:00')
    const completionPayload = {
      tab_id: tabId,
      user_id: userExerciseStateId,
      grade: Number(grade),
      completion_date: completionDate,
    }

    const completionResponse = await fetch(`${basePath}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(completionPayload),
    })

    const completionData = await completionResponse.json()
    if (!completionResponse.ok || !completionData.ok) {
      // Points are not given for a completion that was not recorded
      const completionError = completionData?.error || completionData?.body?.error || ("completion failed (" + completionResponse.status + ")")
      console.error("Completion failed:", completionError, completionData)
      result.textContent = completionError
      result.classList.add("grade-fail")
      return
    }

    // Then, submit full points grading
    const gradePayload = {
      user_exercise_state_id: itemId,
      exercise_id: exerciseId,
      action: "FullPoints",
      user_id: userExerciseStateId,
    }

    console.log("About to post grading with payload:", gradePayload)

    const gradeResponse = await fetch(`${basePath}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gradePayload),
    })

    const gradeData = await gradeResponse.json()
    console.log("Grade response:", gradeResponse.status, gradeData)
    if (!gradeResponse.ok || !gradeData.ok) {
      allOk = false
      const gradeError = gradeData?.error || gradeData?.body?.error || ("grade failed (" + gradeResponse.status + ")")
      result.textContent = gradeError
      result.classList.add("grade-fail")
    }

    if (allOk) {
      result.textContent = "ok"
      result.classList.add("grade-ok")
      buttons.forEach((btn) => {
        btn.classList.remove("grade-btn-selected")
      })
      button.classList.add("grade-btn-selected")
    }
  } catch (err) {
    result.textContent = err.message
    result.classList.add("grade-fail")
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false
    })
  }
})
