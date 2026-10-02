-- Keep profile reads available to signed-in users (names are shown across
-- papers and the admin directory). The base schema has this policy, but it
-- was missing from the incremental migrations used by deployed databases.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select
  using (auth.role() = 'authenticated');
