const STORAGE_KEY = 'agenda-pessoal.tasks.v1'
const PENDING_KEY = 'agenda-pessoal.pending.v1'
const MIGRATED_KEY = 'agenda-pessoal.migrated.v1'
const BACKUP_KEY = 'agenda-pessoal.last-backup.v1'
const BACKUP_KEEP = 30

// A chave publicável pode ficar no código: sem login, o banco não devolve nenhuma tarefa (RLS).
const SUPABASE_URL = 'https://vlsktymnxefpzvmofyvl.supabase.co'
const SUPABASE_KEY = 'sb_publishable_sT1FD9V97a5fHczPxLZnwg_cjM6oeZO'
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

const viewLabels = {
  today: 'Hoje',
  upcoming: 'Próximas',
  all: 'Todas',
  completed: 'Concluídas',
}

const state = {
  tasks: loadTasks(),
  view: 'today',
  search: '',
  editingId: null,
  toastTimer: null,
  audioContext: null,
  user: null,
  pending: loadPending(),
  syncing: false,
  changedWhileSyncing: new Set(),
}

const elements = {
  breadcrumbView: document.querySelector('#breadcrumb-view'),
  topbarDate: document.querySelector('#topbar-date'),
  footerDate: document.querySelector('#footer-date'),
  headingEyebrow: document.querySelector('#heading-eyebrow'),
  headingSubtitle: document.querySelector('#heading-subtitle'),
  pageTitle: document.querySelector('#page-title'),
  listTitle: document.querySelector('#list-title'),
  visibleCount: document.querySelector('#visible-count'),
  todayCount: document.querySelector('#today-count'),
  search: document.querySelector('#search-input'),
  quickAddForm: document.querySelector('#quick-add-form'),
  taskTitle: document.querySelector('#task-title'),
  taskDate: document.querySelector('#task-date'),
  dateLabel: document.querySelector('#date-label'),
  taskRepeat: document.querySelector('#task-repeat'),
  repeatOptions: document.querySelector('#repeat-options'),
  taskWeekdays: document.querySelector('#task-weekdays'),
  taskTime: document.querySelector('#task-time'),
  taskList: document.querySelector('#task-list'),
  emptyState: document.querySelector('#empty-state'),
  emptyTitle: document.querySelector('#empty-title'),
  emptyDescription: document.querySelector('#empty-description'),
  emptyAction: document.querySelector('#empty-action'),
  progressRing: document.querySelector('#progress-ring'),
  progressValue: document.querySelector('#progress-value'),
  progressLabel: document.querySelector('#progress-label'),
  progressDetail: document.querySelector('#progress-detail'),
  clearCompleted: document.querySelector('#clear-completed'),
  listFooter: document.querySelector('#list-footer'),
  footerStatus: document.querySelector('#footer-status'),
  editDialog: document.querySelector('#edit-dialog'),
  editForm: document.querySelector('#edit-form'),
  editTitle: document.querySelector('#edit-task-title'),
  editDate: document.querySelector('#edit-task-date'),
  editDateField: document.querySelector('#edit-date-field'),
  editRepeat: document.querySelector('#edit-task-repeat'),
  editWeekdays: document.querySelector('#edit-task-weekdays'),
  editTimeField: document.querySelector('#edit-time-field'),
  editTime: document.querySelector('#edit-task-time'),
  deleteTask: document.querySelector('#delete-task'),
  closeDialog: document.querySelector('.dialog-close'),
  toast: document.querySelector('#toast'),
  authScreen: document.querySelector('#auth-screen'),
  authForm: document.querySelector('#auth-form'),
  authEmail: document.querySelector('#auth-email'),
  authPassword: document.querySelector('#auth-password'),
  authError: document.querySelector('#auth-error'),
  authSubmit: document.querySelector('#auth-submit'),
  signOut: document.querySelector('#sign-out'),
  backupButton: document.querySelector('#backup-button'),
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })
const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' })
const fullDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTaskLike).map(normalizeTask)
  } catch {
    return []
  }
}

function isTaskLike(task) {
  return task && typeof task.id === 'string' && typeof task.title === 'string'
}

function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title.slice(0, 120),
    dueDate: isValidDate(task.dueDate) ? task.dueDate : '',
    weekdays: Array.isArray(task.weekdays)
      ? [...new Set(task.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [],
    time: isValidTime(task.time) ? task.time : '08:00',
    completedDates: Array.isArray(task.completedDates) ? task.completedDates.filter(isValidDate) : [],
    notifiedDates: Array.isArray(task.notifiedDates) ? task.notifiedDates.filter(isValidDate) : [],
    completed: Boolean(task.completed),
    createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
  }
}

function taskToRow(task) {
  return {
    id: task.id,
    title: task.title,
    due_date: task.dueDate || null,
    weekdays: task.weekdays,
    reminder_time: isValidTime(task.time) ? task.time : '08:00',
    completed: task.completed,
    completed_dates: task.completedDates,
    notified_dates: task.notifiedDates,
    created_at: task.createdAt,
  }
}

function rowToTask(row) {
  return normalizeTask({
    id: row.id,
    title: row.title,
    dueDate: row.due_date ?? '',
    weekdays: row.weekdays,
    time: row.reminder_time,
    completed: row.completed,
    completedDates: row.completed_dates,
    notifiedDates: row.notified_dates,
    createdAt: Number(row.created_at),
  })
}

function loadPending() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}')
    return {
      upserts: Array.isArray(parsed.upserts) ? parsed.upserts : [],
      deletes: Array.isArray(parsed.deletes) ? parsed.deletes : [],
    }
  } catch {
    return { upserts: [], deletes: [] }
  }
}

function savePending() {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pending))
  } catch {}
}

function hasPending() {
  return state.pending.upserts.length > 0 || state.pending.deletes.length > 0
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks))
    return true
  } catch {
    elements.footerStatus.textContent = 'Não foi possível salvar neste dispositivo'
    showToast('O navegador não conseguiu salvar suas tarefas.')
    return false
  }
}

// Grava no aparelho e marca o que precisa subir para a conta.
function persist({ changed = [], removed = [] } = {}) {
  saveTasks()
  if (state.syncing) [...changed, ...removed].forEach((id) => state.changedWhileSyncing.add(id))
  changed.forEach((id) => {
    if (!state.pending.upserts.includes(id)) state.pending.upserts.push(id)
  })
  removed.forEach((id) => {
    state.pending.upserts = state.pending.upserts.filter((item) => item !== id)
    if (!state.pending.deletes.includes(id)) state.pending.deletes.push(id)
  })
  savePending()
  void flushSync()
}

function setSyncStatus(text) {
  elements.footerStatus.textContent = text
}

async function flushSync() {
  if (!state.user || state.syncing || !hasPending()) return !hasPending()
  state.syncing = true
  const upsertIds = [...state.pending.upserts]
  const deleteIds = [...state.pending.deletes]
  try {
    const rows = state.tasks.filter((task) => upsertIds.includes(task.id)).map(taskToRow)
    if (rows.length) {
      const { error } = await db.from('tasks').upsert(rows)
      if (error) throw error
    }
    if (deleteIds.length) {
      const { error } = await db.from('tasks').delete().in('id', deleteIds)
      if (error) throw error
    }
    // Só tira da fila o que foi enviado; o que mudou durante o envio continua na fila.
    state.pending.upserts = state.pending.upserts.filter((id) => !upsertIds.includes(id) || state.changedWhileSyncing.has(id))
    state.pending.deletes = state.pending.deletes.filter((id) => !deleteIds.includes(id) || state.changedWhileSyncing.has(id))
    savePending()
    setSyncStatus('Tudo sincronizado')
    return true
  } catch {
    setSyncStatus('Sem conexão: as alterações sobem quando a internet voltar')
    return false
  } finally {
    state.syncing = false
    const retry = state.changedWhileSyncing.size > 0
    state.changedWhileSyncing.clear()
    if (retry) void flushSync()
  }
}

async function pullTasks() {
  if (!state.user) return false
  await flushSync()
  if (hasPending()) return false

  const { data, error } = await db.from('tasks').select('*').order('created_at')
  if (error) {
    setSyncStatus('Sem conexão: mostrando a última cópia deste aparelho')
    return false
  }

  // Primeiro login: as tarefas que já estavam neste aparelho sobem para a conta.
  if (!data.length && state.tasks.length && !localStorage.getItem(MIGRATED_KEY)) {
    state.pending.upserts = state.tasks.map((task) => task.id)
    savePending()
    const sent = await flushSync()
    if (sent) {
      localStorage.setItem(MIGRATED_KEY, '1')
      showToast(`${state.tasks.length} ${state.tasks.length === 1 ? 'tarefa trazida' : 'tarefas trazidas'} deste aparelho para a sua conta.`)
    }
    return sent
  }

  localStorage.setItem(MIGRATED_KEY, '1')
  state.tasks = data.map(rowToTask)
  saveTasks()
  setSyncStatus('Tudo sincronizado')
  if (!elements.editDialog.open) render()
  return true
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value) {
  return new Date(`${value}T12:00:00`)
}

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function renderDate() {
  const today = new Date()
  const weekday = weekdayFormatter.format(today)
  const date = fullDateFormatter.format(today)
  elements.topbarDate.textContent = date
  elements.footerDate.textContent = date
  elements.headingEyebrow.textContent = `${weekday}, ${date}`.toLocaleUpperCase('pt-BR')
}

function getTodayTasks() {
  const today = localDateString()
  const weekday = parseLocalDate(today).getDay()
  return state.tasks.filter((task) => {
    if (task.weekdays.length) return task.weekdays.includes(weekday) && !task.completedDates.includes(today)
    return !task.completed && task.dueDate === today
  })
}

function getScheduledTasksForToday() {
  const today = localDateString()
  const weekday = parseLocalDate(today).getDay()
  return state.tasks.filter((task) => (
    task.weekdays.length ? task.weekdays.includes(weekday) : task.dueDate === today
  ))
}

function getVisibleTasks() {
  const today = localDateString()
  let tasks = state.tasks

  if (state.view === 'today') {
    const weekday = parseLocalDate(today).getDay()
    tasks = tasks.filter((task) => {
      if (task.weekdays.length) return task.weekdays.includes(weekday) && !task.completedDates.includes(today)
      return !task.completed && task.dueDate && task.dueDate <= today
    })
  } else if (state.view === 'upcoming') {
    tasks = tasks.filter((task) => task.weekdays.length || (!task.completed && task.dueDate > today))
  } else if (state.view === 'completed') {
    tasks = tasks.filter((task) => task.weekdays.length
      ? task.completedDates.includes(today)
      : task.completed)
  }

  if (state.search) {
    const query = state.search.toLocaleLowerCase('pt-BR')
    tasks = tasks.filter((task) => task.title.toLocaleLowerCase('pt-BR').includes(query))
  }

  return [...tasks].sort((a, b) => {
    if (a.weekdays.length && b.weekdays.length) return a.time.localeCompare(b.time) || a.createdAt - b.createdAt
    if (a.weekdays.length) return 1
    if (b.weekdays.length) return -1
    if (a.completed !== b.completed && state.view === 'all') return Number(a.completed) - Number(b.completed)
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return a.createdAt - b.createdAt
  })
}

function updateHeading() {
  const label = viewLabels[state.view]
  elements.breadcrumbView.textContent = label
  elements.listTitle.textContent = state.view === 'today' ? 'Sua lista' : label
  elements.pageTitle.textContent = label

  const subtitles = {
    today: 'Um passo de cada vez. O que merece sua atenção?',
    upcoming: 'Um olhar adiante deixa a semana mais leve.',
    all: 'Tudo o que você decidiu tirar da cabeça.',
    completed: 'Cada pequeno passo também conta.',
  }
  elements.headingSubtitle.textContent = subtitles[state.view]

  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === state.view
    button.classList.toggle('is-active', active)
    if (active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
}

function updateProgress() {
  const todayTasks = getScheduledTasksForToday()
  const today = localDateString()
  const completed = todayTasks.filter((task) => (
    task.weekdays.length ? task.completedDates.includes(today) : task.completed
  )).length
  const total = todayTasks.length
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100)
  elements.progressRing.style.setProperty('--progress', `${percentage * 3.6}deg`)
  elements.progressValue.textContent = `${percentage}%`
  elements.todayCount.textContent = String(todayTasks.length)

  if (total === 0) {
    elements.progressLabel.textContent = 'Comece por aqui'
    elements.progressDetail.textContent = 'Nenhuma tarefa para hoje'
  } else if (percentage === 100) {
    elements.progressLabel.textContent = 'Dia concluído'
    elements.progressDetail.textContent = `${total} ${total === 1 ? 'tarefa finalizada' : 'tarefas finalizadas'}`
  } else {
    elements.progressLabel.textContent = 'Seu progresso'
    elements.progressDetail.textContent = `${completed} de ${total} concluídas`
  }
}

function formatTaskDate(value) {
  const date = parseLocalDate(value)
  const today = localDateString()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowString = localDateString(tomorrow)

  if (value === today) return 'Hoje'
  if (value === tomorrowString) return 'Amanhã'
  return shortDateFormatter.format(date).replace('.', '')
}

function createIconButton(label, icon, className = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `icon-button ${className}`.trim()
  button.setAttribute('aria-label', label)
  button.title = label
  button.innerHTML = icon
  return button
}

function createTaskRow(task, index) {
  const row = document.createElement('article')
  const isRecurring = task.weekdays.length > 0
  const today = localDateString()
  const isComplete = isRecurring ? task.completedDates.includes(today) : task.completed
  row.className = `task-row${isComplete ? ' is-complete' : ''}`
  row.style.animationDelay = `${Math.min(index * 25, 150)}ms`

  const checkboxLabel = document.createElement('label')
  checkboxLabel.className = 'task-check'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = isComplete
  checkbox.disabled = isRecurring && !task.weekdays.includes(parseLocalDate(today).getDay())
  checkbox.setAttribute('aria-label', checkbox.disabled
    ? `Não programado para hoje: ${task.title}`
    : (isComplete ? `Reabrir: ${task.title}` : `Concluir: ${task.title}`))
  checkbox.addEventListener('change', () => toggleTask(task.id))
  const checkboxMark = document.createElement('span')
  checkboxLabel.append(checkbox, checkboxMark)

  const main = document.createElement('div')
  main.className = 'task-main'
  const title = document.createElement('p')
  title.className = 'task-title'
  title.textContent = task.title
  main.append(title)

  if (isRecurring) {
    const schedule = document.createElement('span')
    schedule.className = 'task-date'
    schedule.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M4 10h16"></path></svg>'
    const scheduleText = document.createElement('span')
    scheduleText.textContent = `${formatWeekdays(task.weekdays)} · ${task.time}`
    schedule.append(scheduleText)
    main.append(schedule)
  } else if (task.dueDate) {
    const date = document.createElement('span')
    const isOverdue = !task.completed && task.dueDate < localDateString()
    date.className = `task-date${isOverdue ? ' is-overdue' : ''}`
    date.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M4 10h16"></path></svg>'
    const dateText = document.createElement('span')
    dateText.textContent = isOverdue ? `Atrasada · ${formatTaskDate(task.dueDate)}` : formatTaskDate(task.dueDate)
    date.append(dateText)
    main.append(date)
  }

  const actions = document.createElement('div')
  actions.className = 'task-actions'
  const editButton = createIconButton('Editar tarefa', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z"></path></svg>')
  editButton.addEventListener('click', () => openEditDialog(task))
  const deleteButton = createIconButton('Excluir tarefa', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"></path></svg>', 'delete')
  deleteButton.addEventListener('click', () => removeTask(task.id))
  actions.append(editButton, deleteButton)

  row.append(checkboxLabel, main, document.createElement('span'), actions)
  return row
}

function getEmptyMessage() {
  if (state.search) return ['Nada encontrado.', 'Tente buscar por outro nome.']
  const messages = {
    today: ['Tudo começa com uma tarefa.', 'Anote o que está na sua cabeça e deixe o resto para depois.'],
    upcoming: ['O horizonte está livre.', 'Quando aparecer uma próxima tarefa, ela vai ficar por aqui.'],
    all: ['Sua lista está em branco.', 'Adicione uma tarefa e ela vai aparecer aqui.'],
    completed: ['Ainda não tem nada por aqui.', 'As tarefas que você concluir vão aparecer nesta lista.'],
  }
  return messages[state.view]
}

function render() {
  renderDate()
  updateHeading()
  updateProgress()

  const tasks = getVisibleTasks()
  elements.taskList.replaceChildren(...tasks.map(createTaskRow))
  elements.visibleCount.textContent = String(tasks.length)
  elements.emptyState.hidden = tasks.length > 0
  elements.taskList.hidden = tasks.length === 0
  elements.listFooter.hidden = false

  const [emptyTitle, emptyDescription] = getEmptyMessage()
  elements.emptyTitle.textContent = emptyTitle
  elements.emptyDescription.textContent = emptyDescription
  elements.emptyAction.hidden = state.view === 'completed' || Boolean(state.search)
  const today = localDateString()
  elements.clearCompleted.hidden = !state.tasks.some((task) => (
    task.weekdays.length ? task.completedDates.includes(today) : task.completed
  ))
}

function getSelectedWeekdays(container) {
  return [...container.querySelectorAll('input:checked')]
    .map((input) => Number(input.value))
    .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
}

function formatWeekdays(days) {
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map((day) => labels[day]).join(', ')
}

function addTask(title, dueDate, weekdays = [], time = '') {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) return false
  if (elements.taskRepeat.checked && !weekdays.length) {
    showToast('Escolha pelo menos um dia da semana.')
    return false
  }

  const task = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: trimmedTitle.slice(0, 120),
    dueDate: weekdays.length ? '' : (isValidDate(dueDate) ? dueDate : ''),
    weekdays,
    time: isValidTime(time) ? time : '08:00',
    completedDates: [],
    notifiedDates: [],
    completed: false,
    createdAt: Date.now(),
  }
  state.tasks.push(task)
  persist({ changed: [task.id] })
  render()
  showToast(weekdays.length ? 'Lembrete semanal adicionado.' : 'Tarefa adicionada à sua lista.')
  if (weekdays.length) prepareReminderAlerts()
  return true
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id)
  if (!task) return
  if (task.weekdays.length) {
    const today = localDateString()
    if (task.completedDates.includes(today)) {
      task.completedDates = task.completedDates.filter((date) => date !== today)
    } else {
      task.completedDates.push(today)
    }
  } else {
    task.completed = !task.completed
  }
  persist({ changed: [task.id] })
  render()
}

function removeTask(id) {
  const task = state.tasks.find((item) => item.id === id)
  if (!task) return
  state.tasks = state.tasks.filter((item) => item.id !== id)
  persist({ removed: [id] })
  render()
  showToast('Tarefa excluída.')
}

function openEditDialog(task) {
  state.editingId = task.id
  elements.editTitle.value = task.title
  elements.editDate.value = task.dueDate
  elements.editRepeat.checked = task.weekdays.length > 0
  elements.editWeekdays.querySelectorAll('input').forEach((input) => {
    input.checked = task.weekdays.includes(Number(input.value))
  })
  elements.editTime.value = task.time || '08:00'
  updateEditScheduleFields()
  elements.editDialog.showModal()
  elements.editTitle.focus()
}

function closeEditDialog() {
  state.editingId = null
  elements.editDialog.close()
}

function saveEditedTask(event) {
  event.preventDefault()
  const task = state.tasks.find((item) => item.id === state.editingId)
  const title = elements.editTitle.value.trim()
  if (!task || !title) return
  const weekdays = elements.editRepeat.checked ? getSelectedWeekdays(elements.editWeekdays) : []
  if (elements.editRepeat.checked && !weekdays.length) {
    showToast('Escolha pelo menos um dia da semana.')
    return
  }

  task.title = title.slice(0, 120)
  task.weekdays = weekdays
  task.time = weekdays.length && isValidTime(elements.editTime.value) ? elements.editTime.value : ''
  task.dueDate = weekdays.length ? '' : (isValidDate(elements.editDate.value) ? elements.editDate.value : '')
  if (weekdays.length) task.completed = false
  else {
    task.completedDates = []
    task.notifiedDates = []
  }
  persist({ changed: [task.id] })
  closeEditDialog()
  render()
  showToast(weekdays.length ? 'Lembrete semanal atualizado.' : 'Alterações salvas.')
  if (weekdays.length) prepareReminderAlerts()
}

function updateEditScheduleFields() {
  const recurring = elements.editRepeat.checked
  elements.editDateField.hidden = recurring
  elements.editWeekdays.hidden = !recurring
  elements.editTimeField.hidden = !recurring
  elements.editTime.hidden = !recurring
}

function clearCompletedTasks() {
  const today = localDateString()
  const completedCount = state.tasks.filter((task) => (
    task.weekdays.length ? task.completedDates.includes(today) : task.completed
  )).length
  if (!completedCount) return
  const removed = state.tasks.filter((task) => !task.weekdays.length && task.completed).map((task) => task.id)
  const changed = state.tasks.filter((task) => task.weekdays.length && task.completedDates.includes(today)).map((task) => task.id)
  state.tasks = state.tasks.filter((task) => {
    if (!task.weekdays.length) return !task.completed
    task.completedDates = task.completedDates.filter((date) => date !== today)
    return true
  })
  persist({ changed, removed })
  render()
  showToast(`${completedCount} ${completedCount === 1 ? 'tarefa removida' : 'tarefas removidas'}.`)
}

function showToast(message) {
  window.clearTimeout(state.toastTimer)
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 2600)
}

function unlockReminderSound() {
  if (!state.tasks.some((task) => task.weekdays.length)) return
  const AudioContextType = window.AudioContext || window.webkitAudioContext
  if (AudioContextType) {
    if (!state.audioContext) state.audioContext = new AudioContextType()
    if (state.audioContext.state === 'suspended') void state.audioContext.resume()
  }
}

function prepareReminderAlerts() {
  unlockReminderSound()
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {})
  }
  checkMedicationReminders()
}

function playReminderSound() {
  const context = state.audioContext
  if (!context || context.state !== 'running') return
  const start = context.currentTime
  ;[0, 0.35, 0.7].forEach((offset) => {
    const oscillator = context.createOscillator()
    const volume = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    volume.gain.setValueAtTime(0.0001, start + offset)
    volume.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.02)
    volume.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22)
    oscillator.connect(volume)
    volume.connect(context.destination)
    oscillator.start(start + offset)
    oscillator.stop(start + offset + 0.23)
  })
}

function checkMedicationReminders() {
  const now = new Date()
  const today = localDateString(now)
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const weekday = now.getDay()
  const changed = []

  state.tasks.forEach((task) => {
    if (!task.weekdays.length || !task.weekdays.includes(weekday)) return
    if (task.time > currentTime || task.completedDates.includes(today) || task.notifiedDates.includes(today)) return

    task.notifiedDates.push(today)
    changed.push(task.id)
    playReminderSound()
    showToast(`Hora do lembrete: ${task.title}`)
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Lembrete de medicamento', {
        body: `${task.title} · ${task.time}`,
        tag: `medication-${task.id}-${today}`,
      })
    }
  })

  if (changed.length) persist({ changed })
}

async function showSignedIn(user) {
  state.user = user
  elements.authScreen.hidden = true
  elements.signOut.hidden = false
  setSyncStatus('Sincronizando...')
  const pulled = await pullTasks()
  if (pulled) void runDailyBackup()
}

function showSignedOut() {
  state.user = null
  elements.signOut.hidden = true
  elements.authScreen.hidden = false
  elements.authEmail.focus()
}

async function signIn(event) {
  event.preventDefault()
  elements.authError.hidden = true
  elements.authSubmit.disabled = true
  const { data, error } = await db.auth.signInWithPassword({
    email: elements.authEmail.value.trim(),
    password: elements.authPassword.value,
  })
  elements.authSubmit.disabled = false
  if (error) {
    elements.authError.textContent = error.message === 'Invalid login credentials'
      ? 'E-mail ou senha incorretos.'
      : 'Não foi possível entrar. Confira a internet e tente de novo.'
    elements.authError.hidden = false
    return
  }
  elements.authForm.reset()
  await showSignedIn(data.user)
}

async function signOut() {
  if (hasPending() && !(await flushSync())) {
    showToast('Ainda há alterações sem enviar. Conecte-se à internet antes de sair.')
    return
  }
  await db.auth.signOut()
  state.tasks = []
  saveTasks()
  render()
  showSignedOut()
}

// Backup diário: grava uma cópia das tarefas numa pasta do PC (Edge/Chrome no computador).
function openBackupStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('agenda-backup', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('handles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function backupStore(mode, action) {
  const store = (await openBackupStore()).transaction('handles', mode).objectStore('handles')
  return new Promise((resolve, reject) => {
    const request = action(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function updateBackupButton(folderName) {
  const last = localStorage.getItem(BACKUP_KEY)
  elements.backupButton.textContent = folderName
    ? `Backup em "${folderName}"${last ? ` · último: ${formatTaskDate(last)}` : ''}`
    : 'Escolher pasta do backup'
}

async function chooseBackupFolder() {
  try {
    const folder = await window.showDirectoryPicker({ id: 'agenda-backup', mode: 'readwrite' })
    await backupStore('readwrite', (store) => store.put(folder, 'folder'))
    await runDailyBackup({ force: true })
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Não foi possível usar essa pasta para o backup.')
  }
}

async function runDailyBackup({ force = false } = {}) {
  if (!('showDirectoryPicker' in window) || !state.user) return
  const folder = await backupStore('readonly', (store) => store.get('folder')).catch(() => null)
  updateBackupButton(folder?.name)
  if (!folder) return

  const today = localDateString()
  if (!force && localStorage.getItem(BACKUP_KEY) === today) return

  // O navegador só libera a pasta depois de um clique; tenta de novo no próximo.
  if (await folder.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    if (!navigator.userActivation?.isActive || await folder.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      document.addEventListener('pointerdown', () => void runDailyBackup({ force }), { once: true })
      return
    }
  }

  try {
    const file = await folder.getFileHandle(`agenda-${today}.json`, { create: true })
    const writable = await file.createWritable()
    await writable.write(JSON.stringify({ exportedAt: new Date().toISOString(), tasks: state.tasks }, null, 2))
    await writable.close()

    const backups = []
    for await (const entry of folder.values()) {
      if (entry.kind === 'file' && /^agenda-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) backups.push(entry.name)
    }
    backups.sort().slice(0, -BACKUP_KEEP).forEach((name) => folder.removeEntry(name).catch(() => {}))

    localStorage.setItem(BACKUP_KEY, today)
    updateBackupButton(folder.name)
    if (force) showToast('Backup salvo na pasta escolhida.')
  } catch {
    showToast('Não foi possível salvar o backup de hoje.')
  }
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    state.view = button.dataset.view
    render()
  })
})

elements.quickAddForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const weekdays = elements.taskRepeat.checked ? getSelectedWeekdays(elements.taskWeekdays) : []
  const added = addTask(elements.taskTitle.value, elements.taskDate.value, weekdays, elements.taskTime.value)
  if (added) {
    elements.quickAddForm.reset()
    elements.dateLabel.textContent = 'Data'
    elements.quickAddForm.classList.remove('is-recurring')
    elements.repeatOptions.hidden = true
    elements.taskTitle.focus()
  }
})

elements.taskRepeat.addEventListener('change', () => {
  elements.quickAddForm.classList.toggle('is-recurring', elements.taskRepeat.checked)
  elements.repeatOptions.hidden = !elements.taskRepeat.checked
})

elements.taskDate.addEventListener('change', () => {
  elements.dateLabel.textContent = elements.taskDate.value ? formatTaskDate(elements.taskDate.value) : 'Data'
})

elements.search.addEventListener('input', () => {
  state.search = elements.search.value.trim()
  render()
})

elements.emptyAction.addEventListener('click', () => elements.taskTitle.focus())
elements.clearCompleted.addEventListener('click', clearCompletedTasks)
elements.editForm.addEventListener('submit', saveEditedTask)
elements.editRepeat.addEventListener('change', updateEditScheduleFields)
document.addEventListener('pointerdown', unlockReminderSound, { once: true })
document.addEventListener('keydown', unlockReminderSound, { once: true })
elements.closeDialog.addEventListener('click', closeEditDialog)
elements.deleteTask.addEventListener('click', () => {
  const id = state.editingId
  closeEditDialog()
  if (id) removeTask(id)
})
elements.editDialog.addEventListener('click', (event) => {
  if (event.target === elements.editDialog) closeEditDialog()
})

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !elements.editDialog.open && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault()
    elements.search.focus()
  }
})

elements.authForm.addEventListener('submit', signIn)
elements.signOut.addEventListener('click', signOut)
elements.backupButton.hidden = !('showDirectoryPicker' in window)
elements.backupButton.addEventListener('click', chooseBackupFolder)
window.addEventListener('online', () => void pullTasks())
db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && state.user) showSignedOut()
})

render()
db.auth.getSession().then(({ data }) => {
  if (data.session) void showSignedIn(data.session.user)
  else showSignedOut()
})
window.setInterval(checkMedicationReminders, 15000)
window.setInterval(() => void pullTasks(), 60000)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  checkMedicationReminders()
  void pullTasks()
})