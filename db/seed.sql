-- Example action log rows for local development, with the tabs, courses
-- and exercises of src/config/courses.js and made-up admins and students:
--
--   docker compose exec -T db psql -U mooc -d mooc_grader < db/seed.sql
INSERT INTO action_log
  (created_at, actor_uid, action, tab_id, course_id, exercise_id,
   target_user_id, target_answer_id, details, ok, error)
VALUES
  -- "Full points to correct, reset incorrect" on the fullstack tab
  (now() - interval '3 days 2 hours', 'mluukkai', 'full_points', 'fullstack', 'a7a567d8-ff46-44db-a08e-26073bb07fc6', '83609a83-2022-4ed7-820c-79538604869e',
   gen_random_uuid(), gen_random_uuid(), NULL, true, NULL),
  (now() - interval '3 days 2 hours' + interval '1 second', 'mluukkai', 'full_points', 'fullstack', 'a7a567d8-ff46-44db-a08e-26073bb07fc6', '83609a83-2022-4ed7-820c-79538604869e',
   gen_random_uuid(), gen_random_uuid(), NULL, true, NULL),
  (now() - interval '3 days 2 hours' + interval '2 seconds', 'mluukkai', 'reset', 'fullstack', '37e36bf4-f000-49c7-b420-965d8da82d92', 'a57d8d10-39cc-46cf-935c-fa5f1dd9e686',
   gen_random_uuid(), gen_random_uuid(), '{"justification": "tests must pass in GitHub"}', true, NULL),
  (now() - interval '3 days 2 hours' + interval '3 seconds', 'mluukkai', 'reset', 'fullstack', '37e36bf4-f000-49c7-b420-965d8da82d92', 'a57d8d10-39cc-46cf-935c-fa5f1dd9e686',
   gen_random_uuid(), gen_random_uuid(), '{"justification": "repository must be accessible by user mluukkai"}', false, '500: Internal Server Error'),

  -- Single grades by another admin
  (now() - interval '2 days 5 hours', 'ousavola', 'zero_points', 'docker', 'f46ca98e-1a1f-465b-854f-52534d81a896', 'de2c6f5e-8228-4771-86dd-dc272b5194d6',
   gen_random_uuid(), gen_random_uuid(), NULL, true, NULL),
  (now() - interval '2 days 4 hours', 'ousavola', 'reset', 'docker', 'f46ca98e-1a1f-465b-854f-52534d81a896', '51edb5ec-acd3-421c-924e-6180c93b42c4',
   gen_random_uuid(), gen_random_uuid(), '{"justification": "README.md does not contain the required links"}', true, NULL),

  -- Approve PR, then full points
  (now() - interval '1 day 6 hours', 'mluukkai', 'approve_pr', 'pull-requests', '463de96b-4d52-411e-aa96-8ee315f1211b', 'd6bc57d4-847c-4957-b83b-505eae491687',
   '5b1e0c7a-3f0d-4b8e-9d7a-2c4f6e8a1b3d', NULL, '{"pr_url": "https://github.com/example-student/part13/pull/1", "account": "primary"}', true, NULL),
  (now() - interval '1 day 6 hours' + interval '1 second', 'mluukkai', 'full_points', 'pull-requests', '463de96b-4d52-411e-aa96-8ee315f1211b', 'd6bc57d4-847c-4957-b83b-505eae491687',
   '5b1e0c7a-3f0d-4b8e-9d7a-2c4f6e8a1b3d', gen_random_uuid(), NULL, true, NULL),
  (now() - interval '1 day 5 hours', 'mluukkai', 'approve_pr', 'pull-requests', '463de96b-4d52-411e-aa96-8ee315f1211b', 'd6bc57d4-847c-4957-b83b-505eae491687',
   gen_random_uuid(), NULL, '{"pr_url": "https://github.com/other-student/part13/pull/4"}', false, 'Not Found'),

  -- Completion, then full points
  (now() - interval '1 day 2 hours', 'mluukkai', 'completion', 'kubernetes', 'e0215028-f31f-4e93-8f5b-4d38eaa504a6', NULL,
   '9d4c2b1a-7e6f-4a5b-8c3d-1e2f3a4b5c6d', NULL, '{"grade": 5, "completion_date": "2026-10-19T08:00:00.000+00:00"}', true, NULL),
  (now() - interval '1 day 2 hours' + interval '1 second', 'mluukkai', 'full_points', 'kubernetes', '01651d2e-79fd-4afa-8f76-10850ace9c1c', '8b902358-a26a-5ac4-994c-ebc9bbf60910',
   '9d4c2b1a-7e6f-4a5b-8c3d-1e2f3a4b5c6d', gen_random_uuid(), NULL, true, NULL),

  -- Cheaters page and "All flagged honest"
  (now() - interval '20 hours', 'ousavola', 'cheater_confirm', NULL, 'a7a567d8-ff46-44db-a08e-26073bb07fc6', NULL,
   gen_random_uuid(), NULL, NULL, true, NULL),
  (now() - interval '19 hours', 'ousavola', 'cheater_dismiss', NULL, 'a7a567d8-ff46-44db-a08e-26073bb07fc6', NULL,
   gen_random_uuid(), NULL, NULL, true, NULL),
  (now() - interval '18 hours', 'mluukkai', 'cheater_dismiss', 'fullstack', '37e36bf4-f000-49c7-b420-965d8da82d92', NULL,
   gen_random_uuid(), NULL, '{"bulk": true}', true, NULL),
  (now() - interval '18 hours' + interval '1 second', 'mluukkai', 'cheater_dismiss', 'fullstack', '37e36bf4-f000-49c7-b420-965d8da82d92', NULL,
   gen_random_uuid(), NULL, '{"bulk": true}', true, NULL),

  -- Invitations
  (now() - interval '3 hours', 'mluukkai', 'invite_accept_all', NULL, NULL, NULL,
   NULL, NULL, '{"account": 0, "done": 4, "failed": []}', true, NULL),
  (now() - interval '2 hours', 'mluukkai', 'invite_accept', NULL, NULL, NULL,
   NULL, NULL, '{"account": 1, "invitationId": 284711093}', true, NULL),
  (now() - interval '1 hour', 'ousavola', 'invite_decline_expired', NULL, NULL, NULL,
   NULL, NULL, '{"account": 0, "done": 1, "failed": ["example-student/part3"]}', false, '1 failed');
