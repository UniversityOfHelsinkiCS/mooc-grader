const crypto = require("crypto")

// When the Shibboleth session has expired (1 h without requests), a page
// shown from the browser's history (back button, restored tab) still
// renders, but its stylesheet and scripts are redirected to the login page
// and fail, leaving an unstyled page whose buttons do nothing. Reloading
// goes through the login as a top-level navigation and gets a new session.
//
// This has to be inline: a script in /static would be redirected too. It
// checks a CSS variable that styles.css sets, since a blocked stylesheet
// still leaves an (empty) link.sheet in some browsers. At
// most one reload per 30 s, so a stylesheet broken for some other reason
// cannot cause a reload loop.
const SESSION_GUARD_SCRIPT = `addEventListener("load", () => {
  const style = getComputedStyle(document.documentElement)
  if (style.getPropertyValue("--styles-loaded").trim() === "1") return
  try {
    const last = Number(sessionStorage.getItem("session-guard-reload"))
    if (Date.now() - last < 30000) return
    sessionStorage.setItem("session-guard-reload", String(Date.now()))
  } catch {
    return
  }
  location.reload()
})`

// lets the Content-Security-Policy allow exactly this inline script
const SESSION_GUARD_HASH = `sha256-${crypto
  .createHash("sha256")
  .update(SESSION_GUARD_SCRIPT)
  .digest("base64")}`

module.exports = { SESSION_GUARD_SCRIPT, SESSION_GUARD_HASH }
