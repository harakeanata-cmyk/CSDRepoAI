-- Retire evaluation access while preserving any historical evaluation data.
do $$
begin
  if to_regclass('public.system_evaluations') is not null then
    execute 'drop policy if exists "evaluations_insert_own" on public.system_evaluations';
    execute 'drop policy if exists "evaluations_update_own" on public.system_evaluations';
    execute 'drop policy if exists "evaluations_select_admin" on public.system_evaluations';
    alter table public.system_evaluations enable row level security;
  end if;
end;
$$;
