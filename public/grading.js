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

    if (action === "Completion") {
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
    } else {
      // Original grading flow for FullPoints/ZeroPoints
      const payload = {
        user_exercise_state_id: userExerciseStateId,
        exercise_id: exerciseId,
        action,
      }

      const response = await fetch(`${basePath}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (response.ok && data.ok) {
        result.textContent = "ok"
        result.classList.add("grade-ok")
        buttons.forEach((btn) => {
          btn.classList.remove("grade-btn-selected")
        })
        button.classList.add("grade-btn-selected")
      } else {
        const msg = data?.error || data?.body?.error || ("failed (" + response.status + ")")
        result.textContent = msg
        result.classList.add("grade-fail")
      }
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
