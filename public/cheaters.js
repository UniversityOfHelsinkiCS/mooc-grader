document.addEventListener("click", async (event) => {
  const button = event.target.closest(".cheater-action-btn")
  if (!button) return

  const action = button.dataset.action
  const endpoint = action === "confirm" ? "/confirm-cheater" : "/dismiss-cheater"
  const confirmMessage =
    action === "confirm"
      ? "Confirm this user as a cheater?"
      : "Mark this user as honest?"

  const confirmed = window.confirm(confirmMessage)
  if (!confirmed) return

  const userId = button.dataset.userId
  const actionCell = button.closest("td")
  const result = actionCell?.querySelector(".grade-result")
  const buttons = actionCell ? actionCell.querySelectorAll(".cheater-action-btn") : [button]

  buttons.forEach((btn) => {
    btn.disabled = true
  })
  if (result) {
    result.textContent = "sending..."
    result.className = "grade-result"
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: document.body.dataset.courseId, userId }),
    })
    const data = await response.json()
    if (response.ok && data.ok) {
      if (result) {
        result.textContent = action === "confirm" ? "confirmed" : "honest"
        result.classList.add("grade-ok")
      }
    } else {
      buttons.forEach((btn) => {
        btn.disabled = false
      })
      if (result) {
        result.textContent = data?.error || ("failed (" + response.status + ")")
        result.classList.add("grade-fail")
      }
    }
  } catch (err) {
    buttons.forEach((btn) => {
      btn.disabled = false
    })
    if (result) {
      result.textContent = err.message
      result.classList.add("grade-fail")
    }
  }
})
