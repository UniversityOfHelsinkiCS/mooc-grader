const { SESSION_GUARD_SCRIPT } = require("./sessionGuard")

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function externalLink(url, content = escapeHtml(url)) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${content}</a>`
}

// "2026-10-20 12:14:02", Finnish time
const TIME_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const formatTime = (time) => TIME_FORMAT.format(new Date(time))

const SPINNER = `<span class="spinner" role="status" aria-label="Loading"></span>`

// Placeholder row of the overview page: its script replaces the row with
// the one loaded from url, so slow counts do not hold up the page.
// nameCell is HTML.
function loadingRow(url, nameCell, countColumns) {
  return `<tr data-row-url="${escapeHtml(url)}"><td>${nameCell}</td>${`<td>${SPINNER}</td>`.repeat(countColumns)}</tr>`
}

// basePath is the path prefix the app is served under ("" at the root);
// the page scripts read it from data-base-path for their requests
function layout({
  title,
  body,
  basePath = "",
  bodyClass = null,
  bodyAttributes = "",
}) {
  const classAttribute = bodyClass ? ` class="${bodyClass}"` : ""
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link rel="stylesheet" href="${escapeHtml(basePath)}/static/styles.css">
</head>
<body${classAttribute} data-base-path="${escapeHtml(basePath)}"${bodyAttributes}>
${body}<script>${SESSION_GUARD_SCRIPT}</script>
</body></html>`
}

module.exports = { escapeHtml, externalLink, formatTime, layout, loadingRow }
