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

async function loadRow(row) {
  try {
    const response = await fetch(row.dataset.rowUrl)
    const body = await response.text()
    if (!response.ok) {
      throw new Error(body || `HTTP ${response.status}`)
    }
    row.outerHTML = body
  } catch (err) {
    showError(row, err.message)
  }
}

document.querySelectorAll("tr[data-row-url]").forEach(loadRow)
