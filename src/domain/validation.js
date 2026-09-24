// Checks for values that the browser sends and that are forwarded to mooc.fi

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// e.g. 2026-09-24T10:00:00.000Z or 2026-09-24T10:00:00.000+00:00
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

const MAX_JUSTIFICATION_LENGTH = 1000

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isIsoDateTime(value) {
  return (
    typeof value === "string" &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

module.exports = { isUuid, isIsoDateTime, MAX_JUSTIFICATION_LENGTH }
