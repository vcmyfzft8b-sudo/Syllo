create policy "lectures_delete_own"
  on public.lectures
  for delete
  using (auth.uid() = user_id);
