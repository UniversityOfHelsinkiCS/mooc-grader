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
${body}</body></html>`
}

module.exports = { escapeHtml, externalLink, layout }
