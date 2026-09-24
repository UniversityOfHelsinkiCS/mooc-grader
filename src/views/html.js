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

function layout({ title, body, bodyClass = null, bodyAttributes = "" }) {
  const classAttribute = bodyClass ? ` class="${bodyClass}"` : ""
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body${classAttribute}${bodyAttributes}>
${body}</body></html>`
}

module.exports = { escapeHtml, externalLink, layout }
