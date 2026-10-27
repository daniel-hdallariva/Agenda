// Chamado a cada minuto pelo agendador do banco (pg_cron).
// Confere os horários das tarefas e manda os avisos para os aparelhos ativados.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

// Horário de Brasília (sem horário de verão desde 2019).
const UTC_OFFSET = '-03:00'
// 30 e 15 min antes, na hora, e mais 5 avisos de 5 em 5 min até marcar como feita.
const OFFSETS = [-30, -15, 0, 5, 10, 15, 20, 25]
// Se o agendador atrasar, um aviso ainda sai até 3 min depois; mais que isso é descartado.
const LATE_TOLERANCE_MS = 3 * 60 * 1000

type Task = {
  id: string
  user_id: string
  title: string
  due_date: string | null
  weekdays: number[]
  month_day: number | null
  reminder_time: string | null
  completed: boolean
  completed_dates: string[]
}

type Due = { task: Task; occurrence: string; offset: number }

function localDate(instant: Date) {
  return new Date(instant.getTime() + Number(UTC_OFFSET.slice(0, 3)) * 3600 * 1000).toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function isRecurring(task: Task) {
  return task.weekdays.length > 0 || Boolean(task.month_day)
}

function occursOn(task: Task, date: string) {
  const value = new Date(`${date}T12:00:00Z`)
  if (task.weekdays.length) return task.weekdays.includes(value.getUTCDay())
  if (task.month_day) {
    const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate()
    return value.getUTCDate() === Math.min(task.month_day, lastDay)
  }
  return task.due_date === date
}

function isDoneOn(task: Task, date: string) {
  return isRecurring(task) ? task.completed_dates.includes(date) : task.completed
}

function describe(task: Task, offset: number) {
  if (offset < 0) return `Daqui a ${-offset} min · ${task.reminder_time}`
  if (offset === 0) return `Agora · ${task.reminder_time}`
  return `Atrasada ${offset} min · marque como feita para parar os avisos`
}

function findDue(tasks: Task[], now: Date): Due[] {
  const today = localDate(now)
  // Ontem e amanhã cobrem avisos que atravessam a meia-noite (ex.: 23:50 + 25 min).
  const dates = [shiftDate(today, -1), today, shiftDate(today, 1)]
  const due: Due[] = []
  for (const task of tasks) {
    for (const occurrence of dates) {
      if (!occursOn(task, occurrence) || isDoneOn(task, occurrence)) continue
      const base = new Date(`${occurrence}T${task.reminder_time}:00${UTC_OFFSET}`).getTime()
      for (const offset of OFFSETS) {
        const late = now.getTime() - (base + offset * 60 * 1000)
        if (late >= 0 && late < LATE_TOLERANCE_MS) due.push({ task, occurrence, offset })
      }
    }
  }
  return due
}

Deno.serve(async (request) => {
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('Não autorizado', { status: 401 })
  }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: tasks, error } = await db
    .from('tasks')
    .select('id, user_id, title, due_date, weekdays, month_day, reminder_time, completed, completed_dates')
    .not('reminder_time', 'is', null)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const due = findDue(tasks as Task[], new Date())
  if (!due.length) return Response.json({ due: 0, sent: 0 })

  // Marca como enviado antes de mandar: o que já estava marcado volta vazio e não sai de novo.
  const { data: claimed, error: claimError } = await db
    .from('sent_reminders')
    .upsert(
      due.map(({ task, occurrence, offset }) => ({ task_id: task.id, occurrence, offset_minutes: offset })),
      { onConflict: 'task_id,occurrence,offset_minutes', ignoreDuplicates: true },
    )
    .select('task_id, occurrence, offset_minutes')
  if (claimError) return Response.json({ error: claimError.message }, { status: 500 })

  const claimedKeys = new Set(claimed.map((row) => `${row.task_id}|${row.occurrence}|${row.offset_minutes}`))
  const toSend = due.filter(({ task, occurrence, offset }) => claimedKeys.has(`${task.id}|${occurrence}|${offset}`))
  if (!toSend.length) return Response.json({ due: due.length, sent: 0 })

  const userIds = [...new Set(toSend.map(({ task }) => task.user_id))]
  const { data: subscriptions } = await db.from('push_subscriptions').select('*').in('user_id', userIds)

  let sent = 0
  const failures: string[] = []
  for (const { task, occurrence, offset } of toSend) {
    const payload = JSON.stringify({ title: task.title, body: describe(task, offset), tag: `${task.id}-${occurrence}` })
    for (const subscription of (subscriptions ?? []).filter((item) => item.user_id === task.user_id)) {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload,
          { TTL: 600, urgency: 'high' },
        )
        sent += 1
      } catch (pushError) {
        const status = (pushError as { statusCode?: number }).statusCode
        // 404/410: o aparelho cancelou os avisos; sai da lista.
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
        else failures.push(`${status ?? ''} ${(pushError as Error).message}`.trim())
      }
    }
  }

  return Response.json({ due: due.length, sent, failures })
})
