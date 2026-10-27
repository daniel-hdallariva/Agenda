-- Diagnóstico dos avisos: só lê, não muda nada.
-- Cole no SQL Editor do Supabase, clique em Run e mande um print do resultado.
select 'agendamento' as tipo, jobname || ' | ' || schedule || ' | ativo=' || active as detalhe
from cron.job
union all
(select 'execucao', status || ' | ' || left(coalesce(return_message, ''), 120) || ' | ' || start_time
 from cron.job_run_details order by start_time desc limit 3)
union all
(select 'resposta', coalesce(status_code::text, 'sem status') || ' | ' || left(coalesce(content, error_msg, ''), 120) || ' | ' || created
 from net._http_response order by created desc limit 3)
union all
select 'cofre', 'senha guardada: ' || count(*)::text
from vault.decrypted_secrets where name = 'cron_secret';
