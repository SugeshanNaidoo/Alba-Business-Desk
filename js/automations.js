// Automations — simple WHEN / THEN rules.
//
// A rule looks like:
//   { id, enabled, when: { event, stage? }, then: { action, params } }
//
// SCOPE, STATED HONESTLY: rules are evaluated in the browser, at the moment
// someone performs the triggering action. They do NOT run on a schedule or
// on the server, so nothing fires while the app is closed. Server-side
// evaluation would need Cloud Functions — a separate Firebase product with
// its own billing — so this is a deliberate starting point, not an oversight.
// The UI says so plainly rather than letting it be discovered.

const AUTOMATION_TRIGGERS = {
  'contact.created':    'A contact is created',
  'deal.created':       'A deal is created',
  'deal.stage_changed': 'A deal moves to a stage',
  'deal.won':           'A deal is won',
  'task.completed':     'A task is completed'
};

const AUTOMATION_ACTIONS = {
  'task.create':  'Create a follow-up task',
  'activity.log': 'Log a note on the timeline'
};

/* Guards against a rule triggering itself, directly or through a chain.
   Nothing in the current action set can do that — creating a task does not
   complete one — but an action added later could, and an infinite loop in
   the browser is a hard freeze rather than a caught error. */
let _automationDepth = 0;
const MAX_AUTOMATION_DEPTH = 3;

function automationsFor(event){
  return (DATA.automations || []).filter(a => a.enabled !== false && a.when && a.when.event === event);
}

/* Runs every rule matching an event.
   ctx carries the record that triggered it: { contact } | { deal } | { task }.
   Returns the number of actions performed, so callers can decide whether to
   re-render. */
function runAutomations(event, ctx){
  const rules = automationsFor(event);
  if(!rules.length) return 0;

  if(_automationDepth >= MAX_AUTOMATION_DEPTH){
    console.warn('Automation chain stopped — maximum depth reached. Check for a rule that triggers itself.');
    return 0;
  }
  _automationDepth++;
  let performed = 0;
  try{
    rules.forEach(rule => {
      // Stage filter: only for deal.stage_changed, and only when set.
      if(rule.when.event === 'deal.stage_changed' && rule.when.stage){
        if(!ctx.deal || ctx.deal.stage !== rule.when.stage) return;
      }
      try{
        if(performAutomationAction(rule, ctx)) performed++;
      }catch(err){
        // One broken rule must never block the user's actual action.
        console.error('Automation failed:', rule.id, err);
      }
    });
  }finally{
    _automationDepth--;
  }
  return performed;
}

function performAutomationAction(rule, ctx){
  const p = rule.then.params || {};
  const subject = ctx.contact || ctx.deal || ctx.task || {};
  const subjectName = subject.name || subject.title || 'record';

  // {{name}} lets a rule title reference what triggered it.
  const fill = (s) => String(s || '').replace(/\{\{\s*name\s*\}\}/g, subjectName);

  if(rule.then.action === 'task.create'){
    const days = Number(p.dueInDays);
    const due = new Date();
    due.setDate(due.getDate() + (isFinite(days) ? days : 0));
    DATA.tasks.push({
      id: uid('t'),
      title: fill(p.title) || `Follow up: ${subjectName}`,
      done: false,
      priority: p.priority || 'medium',
      dueDate: due.toISOString().slice(0,10),
      owner: p.assignTo || null,
      // Link the task back to whatever triggered it, so it appears on that
      // record's timeline rather than floating unattached.
      relatedType: ctx.contact ? 'contact' : (ctx.deal ? 'deal' : null),
      relatedId: ctx.contact ? ctx.contact.id : (ctx.deal ? ctx.deal.id : null),
      contactId: ctx.contact ? ctx.contact.id : (ctx.deal ? ctx.deal.contactId || null : null),
      dealId: ctx.deal ? ctx.deal.id : null,
      createdAt: Date.now(),
      createdByAutomation: rule.id
    });
    logActivity(`Automation created task "${fill(p.title) || 'Follow up'}"`, {
      type: 'Automation',
      relatedType: ctx.contact ? 'contact' : (ctx.deal ? 'deal' : null),
      relatedId: ctx.contact ? ctx.contact.id : (ctx.deal ? ctx.deal.id : null)
    });
    return true;
  }

  if(rule.then.action === 'activity.log'){
    logActivity(fill(p.note) || `Automation ran on ${subjectName}`, {
      type: 'Automation',
      relatedType: ctx.contact ? 'contact' : (ctx.deal ? 'deal' : null),
      relatedId: ctx.contact ? ctx.contact.id : (ctx.deal ? ctx.deal.id : null)
    });
    return true;
  }

  console.warn('Unknown automation action:', rule.then.action);
  return false;
}

/* Human-readable summary, used in the settings list. */
function describeAutomation(a){
  const trigger = AUTOMATION_TRIGGERS[a.when && a.when.event] || 'Something happens';
  const stage = (a.when && a.when.stage) ? ` “${a.when.stage}”` : '';
  const action = AUTOMATION_ACTIONS[a.then && a.then.action] || 'do something';
  const p = (a.then && a.then.params) || {};
  let detail = '';
  if(a.then && a.then.action === 'task.create'){
    const d = Number(p.dueInDays);
    detail = ` — “${p.title || 'Follow up'}”${isFinite(d) && d > 0 ? `, due in ${d} day${d===1?'':'s'}` : ', due today'}`;
  }
  return `When ${trigger.toLowerCase()}${stage}, ${action.toLowerCase()}${detail}`;
}


/* ---- UI (Automations tab) ------------------------------------------------
   Lives here rather than in settings.js now that Automations is a top-level
   module: the tab and the engine that powers it belong together. */
/* ---- Automations ---------------------------------------------------------
   Rules live in DATA.automations, which is a config key — so they persist in
   the workspace config document alongside stages and custom fields. */
let editingAutomationId = null;

function renderAutomations(){
  const el = document.getElementById('automationsList');
  if(!el) return;
  const rules = DATA.automations || [];
  el.innerHTML = rules.length ? rules.map(a => `
    <div class="info-row">
      <span style="min-width:0;">
        <strong style="font-size:13.5px;">${escapeHtml(describeAutomation(a))}</strong>
        ${a.enabled === false ? '<span class="tag tag-other" style="margin-left:6px;">Paused</span>' : ''}
      </span>
      <span style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" data-toggle-auto="${a.id}">${a.enabled === false ? 'Enable' : 'Pause'}</button>
        <button class="btn btn-ghost btn-sm" data-edit-auto="${a.id}">Edit</button>
      </span>
    </div>`).join('')
    : '<p class="topbar-sub">No rules yet. A good first one: when a contact is created, create a follow-up task in 3 days.</p>';

  el.querySelectorAll('[data-edit-auto]').forEach(b=>
    b.addEventListener('click', ()=>openAutomationModal(b.dataset.editAuto)));
  el.querySelectorAll('[data-toggle-auto]').forEach(b=>
    b.addEventListener('click', ()=>{
      if(!requireSubscriptionForAction()) return;
      const a = DATA.automations.find(x=>x.id===b.dataset.toggleAuto);
      if(a){ a.enabled = a.enabled === false; saveData(DATA); renderAutomations(); }
    }));
}

function openAutomationModal(id){
  editingAutomationId = id || null;
  const a = id ? (DATA.automations || []).find(x=>x.id===id) : null;
  document.getElementById('automationModalTitle').textContent = a ? 'Edit rule' : 'New rule';

  const trig = document.getElementById('autoTrigger');
  trig.innerHTML = Object.entries(AUTOMATION_TRIGGERS)
    .map(([k,v])=>`<option value="${k}">${escapeHtml(v)}</option>`).join('');
  const act = document.getElementById('autoAction');
  act.innerHTML = Object.entries(AUTOMATION_ACTIONS)
    .map(([k,v])=>`<option value="${k}">${escapeHtml(v)}</option>`).join('');
  document.getElementById('autoStage').innerHTML =
    DATA.stages.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  document.getElementById('autoTaskAssign').innerHTML =
    '<option value="">Nobody in particular</option>' +
    DATA.teamMembers.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

  trig.value = (a && a.when && a.when.event) || 'contact.created';
  act.value  = (a && a.then && a.then.action) || 'task.create';
  if(a && a.when && a.when.stage) document.getElementById('autoStage').value = a.when.stage;
  const p = (a && a.then && a.then.params) || {};
  document.getElementById('autoTaskTitle').value = p.title || '';
  document.getElementById('autoTaskDays').value = p.dueInDays !== undefined ? p.dueInDays : 3;
  document.getElementById('autoTaskPriority').value = p.priority || 'medium';
  document.getElementById('autoTaskAssign').value = p.assignTo || '';
  document.getElementById('autoNoteText').value = p.note || '';

  document.getElementById('deleteAutomationBtn').style.display = a ? 'inline-flex' : 'none';
  syncAutomationFields();
  document.getElementById('automationModalOverlay').classList.add('active');
}

/* The stage picker only applies to one trigger, and the parameter fields
   depend on the action — showing all of them at once invites nonsense rules. */
function syncAutomationFields(){
  document.getElementById('autoStageWrap').style.display =
    document.getElementById('autoTrigger').value === 'deal.stage_changed' ? 'block' : 'none';
  const isTask = document.getElementById('autoAction').value === 'task.create';
  document.getElementById('autoTaskParams').style.display = isTask ? 'block' : 'none';
  document.getElementById('autoNoteParams').style.display = isTask ? 'none' : 'block';
}
document.getElementById('autoTrigger').addEventListener('change', syncAutomationFields);
document.getElementById('autoAction').addEventListener('change', syncAutomationFields);
document.getElementById('addAutomationBtn').addEventListener('click', ()=>{
  if(!requireSubscriptionForAction()) return;
  openAutomationModal(null);
});
