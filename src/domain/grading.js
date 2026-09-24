function calculateGrade(coursePoints) {
  if (typeof coursePoints !== "number" || !Number.isFinite(coursePoints)) {
    return null
  }

  if (coursePoints >= 49) return 5
  if (coursePoints >= 44) return 4
  if (coursePoints >= 39) return 3
  if (coursePoints >= 34) return 2
  if (coursePoints >= 29) return 1
  return 0
}

function parseScore(rawScore) {
  return typeof rawScore === "number"
    ? rawScore
    : typeof rawScore === "string"
      ? Number(rawScore)
      : NaN
}

function readScore(entry) {
  return parseScore(entry?.score_given ?? entry?.scoreGiven)
}

// Course progress is either a list of module entries or a single entry
function totalCoursePoints(progress) {
  if (!progress) {
    return null
  }

  if (Array.isArray(progress)) {
    const scores = progress
      .map(readScore)
      .filter((score) => Number.isFinite(score))

    if (scores.length === 0) {
      return null
    }

    return scores.reduce((sum, score) => sum + score, 0)
  }

  if (typeof progress === "object") {
    const score = readScore(progress)
    return Number.isFinite(score) ? score : null
  }

  return null
}

const {
  isUuid,
  isIsoDateTime,
  MAX_JUSTIFICATION_LENGTH,
} = require("./validation")

const GRADING_ACTIONS = new Set(["FullPoints", "ZeroPoints", "Other"])

// "Other" resets the exercise and requires a justification
function buildGradingDecision({
  user_exercise_state_id,
  exercise_id,
  action,
  justification,
}) {
  if (!isUuid(user_exercise_state_id)) {
    return { error: "Invalid user_exercise_state_id" }
  }
  if (!GRADING_ACTIONS.has(action)) {
    return { error: "Invalid action" }
  }
  if (action === "Other") {
    if (!justification) {
      return { error: "Missing justification" }
    }
    if (
      typeof justification !== "string" ||
      justification.length > MAX_JUSTIFICATION_LENGTH
    ) {
      return {
        error: `Invalid justification: must be text of at most ${MAX_JUSTIFICATION_LENGTH} characters`,
      }
    }
  }

  return {
    payload: {
      user_exercise_state_id,
      exercise_id,
      action,
      manual_points: null,
      justification: action === "Other" ? justification : null,
      hidden: false,
      reset_exercise: action === "Other",
    },
  }
}

// The grade must be given explicitly: an unknown grade must never be
// recorded as a failed completion
function buildCompletion(
  { user_id, grade, completion_date },
  courseModuleId,
  now = new Date(),
) {
  if (!isUuid(user_id)) {
    return { error: "Invalid user_id" }
  }
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    return { error: "Invalid grade: must be an integer 0-5" }
  }
  if (completion_date !== undefined && !isIsoDateTime(completion_date)) {
    return { error: "Invalid completion_date: must be an ISO 8601 date-time" }
  }

  return {
    payload: {
      course_module_id: courseModuleId,
      new_completions: [
        {
          user_id,
          grade,
          completion_date: completion_date ?? now.toISOString(),
          passed: grade >= 1,
        },
      ],
      skip_duplicate_completions: false,
    },
  }
}

module.exports = {
  calculateGrade,
  totalCoursePoints,
  buildGradingDecision,
  buildCompletion,
}
