// Every tab is a page listing the answers requiring attention of its courses.
// The overview page (/) shows the totals of each tab.
//
// Tab:
// id: used in the URL /<id>
// completion: completions are submitted from this tab; its answers are listed
//   per user with name, email, course points and grade (courses need courseId)
//
// Course:
// exerciseId: exercise whose answers requiring attention are listed and graded
// courseId: mooc.fi course the exercise belongs to
// cheaters: list suspected cheaters of the course (needs courseId)
// gha: GitHub Actions status of the repository
// qr: README must contain a QR code
// linkCount: README must contain this many links, one of them to GitHub
const tabs = [
  {
    id: "kubernetes",
    name: "Kubernetes",
    completion: {
      courseModuleId: "9c648dca-9a49-5ba8-ad3d-67848b641fd6",
      courseInstanceId: "e0215028-f31f-4e93-8f5b-4d38eaa504a6",
    },
    courses: [
      {
        exerciseId: "8b902358-a26a-5ac4-994c-ebc9bbf60910",
        name: "kubernetes",
        courseId: "01651d2e-79fd-4afa-8f76-10850ace9c1c",
      },
    ],
  },
  {
    id: "fullstack",
    name: "Full stack",
    courses: [
      {
        exerciseId: "83609a83-2022-4ed7-820c-79538604869e",
        name: "stagemanagement",
        gha: true,
        courseId: "a7a567d8-ff46-44db-a08e-26073bb07fc6",
        cheaters: true,
      },
      {
        exerciseId: "a57d8d10-39cc-46cf-935c-fa5f1dd9e686",
        name: "extension",
        gha: true,
        courseId: "37e36bf4-f000-49c7-b420-965d8da82d92",
        cheaters: true,
      },
      {
        exerciseId: "f6926cac-492d-4caf-a97f-5c2c8e776c19",
        name: "graphql",
        gha: true,
        courseId: "d96d7ec8-4c2b-43fc-bf46-94ebb7fa4fe8",
        cheaters: true,
      },
      {
        exerciseId: "8c8e45c1-e00e-4590-879d-5c7a1ed52c06",
        name: "typescript",
        gha: true,
        courseId: "727b37dd-1ad7-4ffa-971c-d45671eef876",
        cheaters: true,
      },
      {
        exerciseId: "27963151-686e-4218-bbc8-1e696e06cb41",
        name: "react native",
        qr: true,
      },
      {
        exerciseId: "114829c1-280e-4657-a9d2-1615d50956eb",
        name: "ci",
        gha: true,
        linkCount: 2,
      },
      {
        exerciseId: "5eeb3678-c399-4211-8d71-09631d9c25d3",
        name: "containers",
        gha: true,
        linkCount: 1,
      },
      {
        exerciseId: "6701a725-2daa-4cff-80be-0bc3ac0d721f",
        name: "psql",
        gha: true,
      },
      {
        exerciseId: "f6e41e7c-fb88-46fd-b013-890219cb86a6",
        name: "nextjs",
        gha: true,
      },
    ],
  },
]

module.exports = { tabs }
