const CHECKED_PREFIX = "__CHECKED__:"
const UNCHECKED_PREFIX = "__UNCHECKED__:"

function getQuizItemTitleMap(item) {
  return Object.fromEntries(
    (item.tasks ?? [])
      .flatMap((task) => task.public_spec?.items ?? [])
      .map((quizItem) => [quizItem.id, quizItem.title]),
  )
}

function formatItemAnswer(answer, quizItemTitles) {
  if (typeof answer.textData === "string" && answer.textData.trim()) {
    return answer.textData.trim()
  }

  if (typeof answer.checked === "boolean") {
    const title = quizItemTitles[answer.quizItemId] ?? answer.quizItemId
    return `${answer.checked ? CHECKED_PREFIX : UNCHECKED_PREFIX}${title}`
  }

  return null
}

// Flattens an answer (or a submission's tasks) into unique display texts.
// Checkbox answers are encoded with CHECKED_PREFIX / UNCHECKED_PREFIX.
function getItemTexts(item) {
  const quizItemTitles = getQuizItemTitleMap(item)
  const taskAnswers = (item.tasks ?? []).flatMap(
    (task) => task.previous_submission?.data_json?.itemAnswers ?? [],
  )
  const itemAnswers = item.data_json?.itemAnswers ?? []

  return [
    ...new Set(
      [...itemAnswers, ...taskAnswers]
        .map((answer) => formatItemAnswer(answer, quizItemTitles))
        .filter(Boolean),
    ),
  ]
}

function findGithubText(texts) {
  return texts.find((text) => text.includes("github.com")) ?? null
}

module.exports = {
  CHECKED_PREFIX,
  UNCHECKED_PREFIX,
  getItemTexts,
  findGithubText,
}
