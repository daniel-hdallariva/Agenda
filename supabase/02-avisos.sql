-- Etapa 2: avisos, repetição mensal e tarefas atrasadas.
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Pode rodar de novo sem problema.

-- Repetição mensal e horário opcional em tarefas de data única.
alter table public.tasks add column if not exists month_day smallint check (month_day between 1 and 31);
alter table public.tasks alter column reminder_time drop not null;
alter table public.tasks alter column reminder_time drop default;

-- Aparelhos que recebem avisos (um por navegador/app instalado).
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own" on public.push_subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "push_update_own" on public.push_subscriptions;
create policy "push_update_own" on public.push_subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own" on public.push_subscriptions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon;

-- Avisos já enviados, para nenhum sair repetido. Só o servidor mexe aqui.
create table if not exists public.sent_reminders (
  task_id text not null references public.tasks (id) on delete cascade,
  occurrence date not null,
  offset_minutes smallint not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, occurrence, offset_minutes)
);

alter table public.sent_reminders enable row level security;
revoke all on public.sent_reminders from anon, authenticated;

-- Agendador do próprio banco.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A cada minuto: chama o serviço que confere os horários e manda os avisos.
-- A senha da chamada fica guardada no cofre (Vault) do Supabase, não aqui.
select cron.schedule(
  'enviar-avisos',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://vlsktymnxefpzvmofyvl.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);

-- Todo dia às 00:05 (horário de Brasília = 03:05 UTC): tarefa de data única atrasada passa para hoje.
select cron.schedule(
  'mover-atrasadas',
  '5 3 * * *',
  $job$
  update public.tasks
  set due_date = (now() at time zone 'America/Sao_Paulo')::date
  where not completed
    and due_date < (now() at time zone 'America/Sao_Paulo')::date
    and weekdays = '{}'
    and month_day is null;
  $job$
);

-- Todo dia: apaga o registro de avisos com mais de 7 dias.
select cron.schedule(
  'limpar-avisos-enviados',
  '15 3 * * *',
  $job$ delete from public.sent_reminders where sent_at < now() - interval '7 days'; $job$
);
