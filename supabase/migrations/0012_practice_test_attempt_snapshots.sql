alter table public.practice_test_attempt_answers
  add column if not exists question_prompt text,
  add column if not exists answer_guide_snapshot text,
  add column if not exists difficulty_snapshot text,
  add column if not exists source_locator_snapshot text;

update public.practice_test_attempt_answers
set
  question_prompt = coalesce(practice_test_attempt_answers.question_prompt, practice_test_questions.prompt),
  answer_guide_snapshot = coalesce(practice_test_attempt_answers.answer_guide_snapshot, practice_test_questions.answer_guide),
  difficulty_snapshot = coalesce(practice_test_attempt_answers.difficulty_snapshot, practice_test_questions.difficulty),
  source_locator_snapshot = coalesce(practice_test_attempt_answers.source_locator_snapshot, practice_test_questions.source_locator)
from public.practice_test_questions
where practice_test_questions.id = practice_test_attempt_answers.practice_test_question_id;

alter table public.practice_test_attempt_answers
  alter column practice_test_question_id drop not null;

alter table public.practice_test_attempt_answers
  drop constraint if exists practice_test_attempt_answers_practice_test_question_id_fkey;

alter table public.practice_test_attempt_answers
  add constraint practice_test_attempt_answers_practice_test_question_id_fkey
  foreign key (practice_test_question_id)
  references public.practice_test_questions (id)
  on delete set null;
