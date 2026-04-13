create index if not exists chat_messages_lecture_created_idx
  on public.chat_messages (lecture_id, created_at asc);

create index if not exists lectures_user_created_idx
  on public.lectures (user_id, created_at desc);
