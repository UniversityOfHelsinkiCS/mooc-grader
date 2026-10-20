// Applies the filters of the action log page as soon as one changes. Text
// fields apply on Enter or when left; a date only once its year is typed in
// full, not on every digit
const form = document.querySelector(".log-filters")
if (form) {
  form.addEventListener("change", (event) => {
    const field = event.target
    if (field.type === "date" && field.value && Number(field.value.slice(0, 4)) < 2000) return
    form.requestSubmit()
  })

  // Empty filters are left out of the URL
  form.addEventListener("submit", () => {
    for (const field of form.elements) {
      if (field.name && !field.value) field.disabled = true
    }
  })
}
