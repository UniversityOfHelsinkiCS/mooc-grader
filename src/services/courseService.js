const { getItemTexts, findGithubText } = require("../domain/answers")
const {
  readmeHasQrCode,
  extractReadmeUrls,
  readmeLinksOk,
} = require("../domain/repository")

// Loads every course of a tab; a course that fails is returned as
// { name, error } so that the other courses can still be shown
async function settleCourses(courses, load) {
  const settled = await Promise.allSettled(
    courses.map(async (course) => load(course)),
  )
  return settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") {
      return outcome.value
    }
    const { name } = courses[index]
    const error = outcome.reason?.message ?? "unknown error"
    console.error(`Loading ${name} failed:`, error)
    return { name, error }
  })
}

async function mapByUserId(userIds, fetchForUser) {
  const entries = await Promise.all(
    userIds.map(async (userId) => [userId, await fetchForUser(userId)]),
  )
  return new Map(entries)
}

function createCourseService({ mooc, github }) {
  function getCourseUserPoints(courseId, userIds) {
    if (!courseId || userIds.length === 0) {
      return new Map()
    }
    return mapByUserId(userIds, (userId) =>
      mooc.getUserCoursePoints(courseId, userId),
    )
  }

  function getCourseUserDetails(courseId, userIds) {
    if (!courseId || userIds.length === 0) {
      return new Map()
    }
    return mapByUserId(userIds, (userId) =>
      mooc.getUserDetails(courseId, userId),
    )
  }

  // Runs the repository checks enabled for the course; every GitHub resource
  // is fetched at most once per answer and independent calls run in parallel
  async function checkRepository(item, course) {
    const repoUrl = item._repoUrl
    const needsReadme = course.qr || course.linkCount

    const [ghaStatus, readme, repoExists] = await Promise.all([
      course.gha && repoUrl ? github.getGhaStatus(repoUrl) : null,
      needsReadme && repoUrl ? github.getReadme(repoUrl) : null,
      !course.gha && repoUrl ? github.repoExists(repoUrl) : null,
    ])

    if (course.gha) {
      item._ghaStatus = ghaStatus
    }
    item._repoExists = course.gha ? (ghaStatus?.repoExists ?? null) : repoExists

    if (course.qr) {
      item._qrExists = !repoUrl
        ? null
        : !readme
          ? null
          : readme.found && readmeHasQrCode(readme.text)
    }
    if (course.linkCount) {
      item._readmeUrls = readme?.found ? extractReadmeUrls(readme.text) : []
      item._linksOk = repoUrl
        ? readmeLinksOk(item._readmeUrls, course.linkCount)
        : null
    }
  }

  function countFlaggedCheaters(course) {
    return course.cheaters
      ? mooc.getFlaggedCheaters(course.courseId).then((flagged) => flagged.size)
      : null
  }

  // Fetches the answers of a course and annotates each with repository check
  // results and, with withUserInfo, user details and course points
  // (the underscore-prefixed fields)
  async function fetchCourseData(course, { withUserInfo = false } = {}) {
    const answers = await mooc.fetchAllAnswers(course.exerciseId)
    const userIds = [
      ...new Set(answers.map((item) => item.user_id).filter(Boolean)),
    ]
    const userInfoCourseId = withUserInfo ? course.courseId : null
    const [userPointsById, userDetailsById] = await Promise.all([
      getCourseUserPoints(userInfoCourseId, userIds),
      getCourseUserDetails(userInfoCourseId, userIds),
    ])

    for (const item of answers) {
      item._coursePoints = userPointsById.get(item.user_id) ?? null
      const details = userDetailsById.get(item.user_id)
      item._userName = details?.name ?? null
      item._userEmail = details?.email ?? null
      item._repoUrl = findGithubText(getItemTexts(item))
    }

    const [cheaterCount] = await Promise.all([
      countFlaggedCheaters(course),
      ...answers.map((item) => checkRepository(item, course)),
    ])

    return {
      exerciseId: course.exerciseId,
      courseId: course.courseId ?? null,
      name: course.name,
      gha: !!course.gha,
      qr: !!course.qr,
      linkCount: course.linkCount ?? null,
      cheaterCount,
      answers,
    }
  }

  // Everything a tab page shows; tabs with completions list users
  function fetchTabData(tab) {
    const withUserInfo = !!tab.completion
    return settleCourses(tab.courses, (course) =>
      fetchCourseData(course, { withUserInfo }),
    )
  }

  // Totals for the overview page: only answers and flagged cheaters are
  // counted, no repository checks or user lookups
  async function fetchTabOverview(tab) {
    const counts = await settleCourses(tab.courses, async (course) => {
      const [answers, cheaterCount] = await Promise.all([
        mooc.fetchAllAnswers(course.exerciseId),
        countFlaggedCheaters(course),
      ])
      return { answerCount: answers.length, cheaterCount: cheaterCount ?? 0 }
    })

    const loaded = counts.filter((count) => !count.error)
    return {
      id: tab.id,
      name: tab.name,
      answerCount: loaded.reduce((sum, count) => sum + count.answerCount, 0),
      cheaterCount: loaded.reduce((sum, count) => sum + count.cheaterCount, 0),
      failed: counts.filter((count) => count.error),
    }
  }

  // The GitHub link of a submission, or all its answers joined
  async function getSubmissionContent(submissionId) {
    const tasks = await mooc.getSubmissionTasks(submissionId)
    if (tasks === null) {
      return null
    }
    const texts = getItemTexts({ tasks })
    return findGithubText(texts) ?? texts.join(", ")
  }

  async function getGhSubmissionsForUser(course, userId) {
    const statuses = await mooc.getExerciseStatuses(course.courseId, userId)
    const entry = statuses.find(
      (item) => item.exercise?.id === course.exerciseId,
    )
    const submissions = entry?.exercise_slide_submissions ?? []
    const contents = await Promise.all(
      submissions.map((submission) => getSubmissionContent(submission.id)),
    )
    return [...new Set(contents.filter(Boolean))]
  }

  async function fetchCheatersData(course) {
    const flaggedCheaters = await mooc.getFlaggedCheaters(course.courseId)
    const userIds = [...flaggedCheaters.keys()]
    const [userDetailsById, submissionsById] = await Promise.all([
      getCourseUserDetails(course.courseId, userIds),
      mapByUserId(userIds, (userId) =>
        getGhSubmissionsForUser(course, userId),
      ),
    ])

    const cheaters = userIds.map((userId) => {
      const info = flaggedCheaters.get(userId)
      const details = userDetailsById.get(userId)
      return {
        userId,
        name: details?.name ?? null,
        email: details?.email ?? null,
        durationMinutes: Math.round(info.totalDurationSeconds / 60),
        totalPoints: info.totalPoints,
        submissions: submissionsById.get(userId) ?? [],
      }
    })

    return { name: course.name, cheaters }
  }

  return { fetchCourseData, fetchTabData, fetchTabOverview, fetchCheatersData }
}

module.exports = { createCourseService }
