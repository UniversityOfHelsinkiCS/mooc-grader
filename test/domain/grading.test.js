const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  calculateGrade,
  totalCoursePoints,
  buildGradingDecision,
  buildCompletion,
} = require("../../src/domain/grading")

describe("calculateGrade", () => {
  test("maps points to grades at the boundaries", () => {
    const cases = [
      [28.9, 0],
      [29, 1],
      [33.9, 1],
      [34, 2],
      [39, 3],
      [44, 4],
      [48.9, 4],
      [49, 5],
      [60, 5],
    ]
    for (const [points, grade] of cases) {
      assert.equal(calculateGrade(points), grade, `${points} points`)
    }
  })

  test("returns null when points are unknown", () => {
    assert.equal(calculateGrade(null), null)
    assert.equal(calculateGrade("45"), null)
    assert.equal(calculateGrade(NaN), null)
  })
})

describe("totalCoursePoints", () => {
  test("sums scores of all modules", () => {
    const progress = [
      { score_given: 30 },
      { scoreGiven: "12.5" },
      { score_given: null },
    ]
    assert.equal(totalCoursePoints(progress), 42.5)
  })

  test("reads the score of a single progress object", () => {
    assert.equal(totalCoursePoints({ score_given: 17 }), 17)
  })

  test("returns null when there are no scores", () => {
    assert.equal(totalCoursePoints([]), null)
    assert.equal(totalCoursePoints([{ score_given: "abc" }]), null)
    assert.equal(totalCoursePoints({}), null)
    assert.equal(totalCoursePoints(null), null)
  })
})

describe("buildGradingDecision", () => {
  const ids = { user_exercise_state_id: "33333333-3333-4333-8333-333333333333", exercise_id: "ex1" }

  test("builds a full points decision", () => {
    const { payload } = buildGradingDecision({ ...ids, action: "FullPoints" })
    assert.deepEqual(payload, {
      ...ids,
      action: "FullPoints",
      manual_points: null,
      justification: null,
      hidden: false,
      reset_exercise: false,
    })
  })

  test("ignores a justification unless the exercise is reset", () => {
    const { payload } = buildGradingDecision({
      ...ids,
      action: "ZeroPoints",
      justification: "copied",
    })
    assert.equal(payload.justification, null)
    assert.equal(payload.reset_exercise, false)
  })

  test("resets the exercise with a justification on Other", () => {
    const { payload } = buildGradingDecision({
      ...ids,
      action: "Other",
      justification: "tests must pass in GitHub",
    })
    assert.equal(payload.reset_exercise, true)
    assert.equal(payload.justification, "tests must pass in GitHub")
  })

  test("rejects unknown or missing actions instead of giving full points", () => {
    for (const action of ["Fullpoints", "", undefined]) {
      assert.deepEqual(buildGradingDecision({ ...ids, action }), {
        error: "Invalid action",
      })
    }
  })

  test("rejects a user_exercise_state_id that is not a UUID", () => {
    for (const id of ["ues1", "../x", 42, undefined]) {
      assert.deepEqual(
        buildGradingDecision({ ...ids, user_exercise_state_id: id, action: "FullPoints" }),
        { error: "Invalid user_exercise_state_id" },
      )
    }
  })

  test("rejects a justification that is not short text", () => {
    for (const justification of ["x".repeat(1001), { text: "hi" }, ["a"]]) {
      const { error } = buildGradingDecision({ ...ids, action: "Other", justification })
      assert.match(error, /Invalid justification/)
    }
    const { payload } = buildGradingDecision({
      ...ids,
      action: "Other",
      justification: "x".repeat(1000),
    })
    assert.equal(payload.justification.length, 1000)
  })

  test("refuses a reset without a justification", () => {
    assert.deepEqual(buildGradingDecision({ ...ids, action: "Other" }), {
      error: "Missing justification",
    })
  })
})

describe("buildCompletion", () => {
  const now = new Date("2026-09-24T10:00:00.000Z")

  test("marks grades 1-5 as passed", () => {
    const { payload } = buildCompletion(
      { user_id: "44444444-4444-4444-8444-444444444444", grade: 3, completion_date: "2026-09-20T00:00:00+00:00" },
      "module1",
      now,
    )
    assert.deepEqual(payload, {
      course_module_id: "module1",
      new_completions: [
        {
          user_id: "44444444-4444-4444-8444-444444444444",
          grade: 3,
          completion_date: "2026-09-20T00:00:00+00:00",
          passed: true,
        },
      ],
      skip_duplicate_completions: false,
    })
  })

  test("marks grade 0 as failed and defaults the date to now", () => {
    const [completion] = buildCompletion(
      { user_id: "44444444-4444-4444-8444-444444444444", grade: 0 },
      "module1",
      now,
    ).payload.new_completions
    assert.equal(completion.passed, false)
    assert.equal(completion.completion_date, now.toISOString())
  })

  test("rejects a user_id that is not a UUID", () => {
    assert.deepEqual(buildCompletion({ user_id: "u1", grade: 3 }, "module1", now), {
      error: "Invalid user_id",
    })
  })

  test("accepts ISO 8601 completion dates and rejects anything else", () => {
    for (const date of ["2026-09-24T10:00:00.000Z", "2026-09-24T10:00:00+03:00"]) {
      const { payload } = buildCompletion(
        { user_id: "44444444-4444-4444-8444-444444444444", grade: 3, completion_date: date },
        "module1",
        now,
      )
      assert.equal(payload.new_completions[0].completion_date, date)
    }
    for (const date of ["2026-09-24", "yesterday", "2026-13-45T99:00:00Z", 1727000000, null, ""]) {
      const result = buildCompletion(
        { user_id: "44444444-4444-4444-8444-444444444444", grade: 3, completion_date: date },
        "module1",
        now,
      )
      assert.match(result.error ?? "", /Invalid completion_date/, String(date))
    }
  })

  test("rejects an unknown grade instead of recording a failure", () => {
    for (const grade of [undefined, null, "", "4", 2.5, -1, 6, NaN]) {
      assert.deepEqual(
        buildCompletion({ user_id: "44444444-4444-4444-8444-444444444444", grade }, "module1", now),
        { error: "Invalid grade: must be an integer 0-5" },
        String(grade),
      )
    }
  })
})
