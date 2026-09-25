// Lookups over the tab configuration, and a startup check that catches
// mistakes when a tab or course is added

function allCourses(tabs) {
  return tabs.flatMap((tab) => tab.courses)
}

function findTab(tabs, tabId) {
  return tabs.find((tab) => tab.id === tabId) ?? null
}

function findCourseByExercise(tabs, exerciseId) {
  return allCourses(tabs).find((course) => course.exerciseId === exerciseId) ?? null
}

function findCheatersCourse(tabs, courseId) {
  return (
    allCourses(tabs).find(
      (course) => course.courseId === courseId && course.cheaters,
    ) ?? null
  )
}

// Tab pages are served at /<id>, so an id must not shadow another route
const RESERVED_TAB_IDS = [
  "static",
  "cheaters",
  "grade",
  "completion",
  "confirm-cheater",
  "dismiss-cheater",
  "invites",
  "invitations",
]

function validateTabs(tabs) {
  const problems = []
  const tabIds = new Set()
  const exerciseIds = new Set()

  for (const tab of tabs) {
    if (!/^[a-z0-9-]+$/.test(tab.id ?? "")) {
      problems.push(`tab id "${tab.id}" must be lowercase letters, digits or -`)
    }
    if (RESERVED_TAB_IDS.includes(tab.id)) {
      problems.push(`tab id "${tab.id}" is reserved for another route`)
    }
    if (tabIds.has(tab.id)) problems.push(`duplicate tab id "${tab.id}"`)
    tabIds.add(tab.id)

    if (tab.completion) {
      const { courseModuleId, courseInstanceId } = tab.completion
      if (!courseModuleId || !courseInstanceId) {
        problems.push(`tab "${tab.id}": completion needs courseModuleId and courseInstanceId`)
      }
    }

    for (const course of tab.courses ?? []) {
      if (exerciseIds.has(course.exerciseId)) {
        problems.push(`exercise ${course.exerciseId} is in more than one course`)
      }
      exerciseIds.add(course.exerciseId)

      if ((tab.completion || course.cheaters) && !course.courseId) {
        problems.push(`course "${course.name}" in tab "${tab.id}" needs courseId`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid tab configuration:\n- ${problems.join("\n- ")}`)
  }
  return tabs
}

module.exports = {
  allCourses,
  findTab,
  findCourseByExercise,
  findCheatersCourse,
  validateTabs,
}
