// Path prefix the app is served under, set by the server on <body>
const basePath = document.body.dataset.basePath ?? ""

let pendingReset = null

function openResetModal(userExerciseStateId, exerciseId, button) {
  pendingReset = { userExerciseStateId, exerciseId, button }
  const select = document.getElementById("reset-reason-select")
  const textarea = document.getElementById("reset-reason-text")
  select.value =
    button.dataset.repoMissing === "true"
      ? "repository must be accessible by user mluukkai"
      : button.dataset.ghaFailed === "true"
        ? "tests must pass in GitHub"
        : button.dataset.qrMissing === "true"
          ? "QR-code missing"
          : button.dataset.linksMissing === "true"
            ? "README.md does not contain the required links"
            : select.options[0].value
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

document.getElementById("reset-modal-submit").addEventListener("click", async () => {
  if (!pendingReset) return
  const select = document.getElementById("reset-reason-select")
  const textarea = document.getElementById("reset-reason-text")
  const justification = select.value === "__other__" ? textarea.value.trim() : select.value
  if (!justification) {
    textarea.focus()
    return
  }

  const { userExerciseStateId, exerciseId, button } = pendingReset
  const actionCell = button.closest("td")
  const result = actionCell?.querySelector(".grade-result")
  const buttons = actionCell ? actionCell.querySelectorAll(".grade-btn") : [button]

  closeResetModal()

  buttons.forEach((btn) => {
    btn.disabled = true
  })
  if (result) {
    result.textContent = "sending..."
    result.className = "grade-result"
  }

  try {
    const response = await fetch(`${basePath}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_exercise_state_id: userExerciseStateId,
        exercise_id: exerciseId,
        action: "Other",
        justification,
      }),
    })

    const data = await response.json()
    if (response.ok && data.ok) {
      if (result) {
        result.textContent = "reset"
        result.classList.add("grade-ok")
      }
      buttons.forEach((btn) => {
        btn.classList.remove("grade-btn-selected")
      })
      button.classList.add("grade-btn-selected")
    } else {
      const msg = data?.error || data?.body?.error || ("failed (" + response.status + ")")
      if (result) {
        result.textContent = msg
        result.classList.add("grade-fail")
      }
    }
  } catch (err) {
    if (result) {
      result.textContent = err.message
      result.classList.add("grade-fail")
    }
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false
    })
  }
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

  let ok = false
  let message
  try {
    const response = await fetch(`${basePath}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_exercise_state_id: button.dataset.userId,
        exercise_id: button.dataset.exerciseId,
        action: button.dataset.action,
      }),
    })
    const data = await response.json()
    ok = response.ok && data.ok
    message = ok ? "ok" : data?.error || data?.body?.error || ("failed (" + response.status + ")")
  } catch (err) {
    message = err.message
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false
    })
  }

  if (result) {
    result.textContent = message
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

  let ok = false
  let message
  try {
    const response = await fetch(`${basePath}/approve-pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exercise_id: button.dataset.exerciseId,
        pr_url: button.dataset.prUrl,
      }),
    })
    const data = await response.json()
    ok = response.ok && data.ok
    message = ok ? `approved (${data.account})` : data?.error || ("failed (" + response.status + ")")
  } catch (err) {
    message = err.message
  } finally {
    button.disabled = false
  }

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
    const targets = [
      ...document.querySelectorAll('.grade-btn[data-action="FullPoints"][data-correct="true"]'),
    ].filter((button) => !button.classList.contains("grade-btn-selected"))
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
    openResetModal(userExerciseStateId, exerciseId, button)
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
