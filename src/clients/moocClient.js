const { totalCoursePoints } = require("../domain/grading")

function createMoocClient({ http, baseUrl, cookie, pageLimit = 50 }) {
  const headers = { Cookie: cookie }

  const get = (path) => http.get(`${baseUrl}${path}`, headers)
  const post = (path, payload) =>
    http.postJson(`${baseUrl}${path}`, payload, headers)

  async function fetchAnswersPage(exerciseId, page) {
    const { status, body } = await get(
      `/exercises/${exerciseId}/answers-requiring-attention?page=${page}&limit=${pageLimit}`,
    )
    if (status === 401 || status === 403) {
      throw new Error(
        `mooc.fi rejected the session cookie (${status}): it has probably expired, update the cookie and restart`,
      )
    }
    if (status !== 200 || !Array.isArray(body?.data)) {
      throw new Error(`mooc.fi answers request failed (${status})`)
    }
    return body
  }

  async function fetchAllAnswers(exerciseId) {
    const first = await fetchAnswersPage(exerciseId, 1)
    const totalPages = first.total_pages ?? 1
    const allData = [...first.data]
    for (let page = 2; page <= totalPages; page++) {
      const result = await fetchAnswersPage(exerciseId, page)
      allData.push(...result.data)
    }
    return allData
  }

  // Map of user id -> { totalDurationSeconds, totalPoints }
  async function getFlaggedCheaters(courseId) {
    if (!courseId) {
      return new Map()
    }

    try {
      const { status, body } = await get(
        `/courses/${courseId}/suspected-cheaters?status=Flagged`,
      )

      if (status !== 200 || !Array.isArray(body)) {
        return new Map()
      }

      return new Map(
        body.map((entry) => [
          entry.user_id,
          {
            totalDurationSeconds: entry.total_duration_seconds,
            totalPoints: entry.total_points,
          },
        ]),
      )
    } catch (error) {
      console.error(`Suspected cheaters error for ${courseId}:`, error.message)
      return new Map()
    }
  }

  async function getUserCoursePoints(courseId, userId) {
    if (!courseId || !userId) {
      return null
    }

    try {
      const { status, body } = await get(
        `/courses/${courseId}/progress/${userId}`,
      )
      if (status !== 200) {
        return null
      }
      return totalCoursePoints(body)
    } catch (error) {
      console.error(
        `Course progress points error for ${courseId}/${userId}:`,
        error.message,
      )
      return null
    }
  }

  // { name, email } or null
  async function getUserDetails(courseId, userId) {
    if (!courseId || !userId) {
      return null
    }

    try {
      const { status, body } = await post("/user-details/user-by-courses", {
        user_id: userId,
        course_ids: [courseId],
      })

      if (status !== 200 || !body || typeof body !== "object") {
        return null
      }

      const firstName =
        typeof body.first_name === "string" ? body.first_name.trim() : ""
      const lastName =
        typeof body.last_name === "string" ? body.last_name.trim() : ""
      const name = `${firstName} ${lastName}`.trim()
      const email = typeof body.email === "string" ? body.email.trim() : ""

      return {
        name: name || null,
        email: email || null,
      }
    } catch (error) {
      console.error(
        `User details error for ${courseId}/${userId}:`,
        error.message,
      )
      return null
    }
  }

  // Returns the submission's tasks, or null
  async function getSubmissionTasks(submissionId) {
    try {
      const { status, body } = await get(
        `/exercise-slide-submissions/${submissionId}/info`,
      )
      if (status !== 200 || !body) {
        return null
      }
      return body.tasks
    } catch (error) {
      console.error(`Submission info error for ${submissionId}:`, error.message)
      return null
    }
  }

  async function getExerciseStatuses(courseId, userId) {
    try {
      const { status, body } = await get(
        `/courses/${courseId}/status-for-all-exercises/${userId}`,
      )
      return status === 200 && Array.isArray(body) ? body : []
    } catch (error) {
      console.error(
        `Status-for-all-exercises error for ${courseId}/${userId}:`,
        error.message,
      )
      return []
    }
  }

  function postGradingDecision(payload) {
    return post("/teacher-grading-decisions", payload)
  }

  function postCompletions(courseInstanceId, payload) {
    return post(`/course-instances/${courseInstanceId}/completions`, payload)
  }

  // action: "confirm" | "dismiss"
  function postCheaterAction(courseId, action, userId) {
    return post(`/courses/${courseId}/suspected-cheaters/${action}/${userId}`, {})
  }

  return {
    fetchAllAnswers,
    getFlaggedCheaters,
    getUserCoursePoints,
    getUserDetails,
    getSubmissionTasks,
    getExerciseStatuses,
    postGradingDecision,
    postCompletions,
    postCheaterAction,
  }
}

module.exports = { createMoocClient }
