// Tasks tab: the task list and the add/edit modal.

/* ---------- Render: Tasks ---------- */
let taskFilter = 'open';
function renderTasks(){
  document.querySelectorAll('#taskFilters .chip').forEach(el=>{
    el.classList.toggle('active', el.dataset.filter===taskFilter);
    el.onclick = ()=>{ taskFilter = el.dataset.filter; renderTasks(); };
  });
  let list = DATA.tasks.slice().sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  if(taskFilter==='open') list = list.filter(t=>!t.done);
  if(taskFilter==='done') list = list.filter(t=>t.done);

  const tbody = document.getElementById('tasksTbody');
  document.getElementById('tasksEmpty').style.display = list.length?'none':'block';
  tbody.innerHTML = list.map(t=>{
    let related = '—';
    if(t.relatedType==='contact'){ const c=contactById(t.relatedId); related = c?c.name:'—'; }
    if(t.relatedType==='deal'){ const d=dealById(t.relatedId); related = d?d.title:'—'; }
    return `<tr data-task="${t.id}">
      <td onclick="event.stopPropagation()"><input type="checkbox" data-task-toggle="${t.id}" ${t.done?'checked':''}></td>
      <td style="${t.done?'text-decoration:line-through;color:var(--graphite);':''}">${escapeHtml(t.title)}${t.recurrence && t.recurrence.type!=='none' ? ` <span class="topbar-sub" style="font-size:11px;">&#8635; ${t.recurrence.type}</span>` : ''}</td>
      <td>${escapeHtml(related)}</td>
      <td style="${isOverdue(t)?'color:var(--clay);font-weight:600;':''}">${fmtDate(t.dueDate)}</td>
      <td><span class="priority-dot priority-${t.priority}" style="display:inline-block;margin-right:5px;"></span>${t.priority}</td>
      <td></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click',()=>openTaskModal(tr.dataset.task));
  });
}

function advanceDate(dateStr, recurrence){
  const d = dateStr ? new Date(dateStr) : new Date();
  if(recurrence.type==='daily') d.setDate(d.getDate()+ (recurrence.interval||1));
  else if(recurrence.type==='weekly') d.setDate(d.getDate()+ 7*(recurrence.interval||1));
  else if(recurrence.type==='monthly') d.setMonth(d.getMonth()+ (recurrence.interval||1));
  return d.toISOString().slice(0,10);
}
document.addEventListener('change', e=>{
  if(e.target.dataset && e.target.dataset.taskToggle){
    const t = DATA.tasks.find(x=>x.id===e.target.dataset.taskToggle);
    if(t){
      t.done = e.target.checked;
      if(t.done && t.recurrence && t.recurrence.type!=='none'){
        DATA.tasks.push({
          id:uid('t'), title:t.title, priority:t.priority, done:false,
          relatedId:t.relatedId, relatedType:t.relatedType, recurrence:t.recurrence,
          dueDate: advanceDate(t.dueDate, t.recurrence)
        });
        logActivity(`Scheduled next occurrence of "${t.title}"`);
      }
      saveData(DATA); renderAll();
    }
  }
});



/* ---------- Modals: Task ---------- */
let editingTaskId = null;
function refreshTaskRelated(){
  const sel = document.getElementById('tRelated');
  let opts = '<option value="">None</option>';
  opts += DATA.contacts.map(c=>`<option value="contact:${c.id}">Contact — ${escapeHtml(c.name)}</option>`).join('');
  opts += DATA.deals.map(d=>`<option value="deal:${d.id}">Deal — ${escapeHtml(d.title)}</option>`).join('');
  sel.innerHTML = opts;
}
function openTaskModal(id){
  editingTaskId = id || null;
  refreshTaskRelated();
  const t = id ? DATA.tasks.find(x=>x.id===id) : null;
  document.getElementById('taskModalTitle').textContent = t ? 'Edit task' : 'Add task';
  document.getElementById('tTitle').value = t ? t.title : '';
  document.getElementById('tDue').value = t ? t.dueDate : '';
  document.getElementById('tPriority').value = t ? t.priority : 'medium';
  document.getElementById('tRelated').value = t && t.relatedType ? `${t.relatedType}:${t.relatedId}` : '';
  document.getElementById('tRecurrence').value = t && t.recurrence ? t.recurrence.type : 'none';
  document.getElementById('deleteTaskBtn').style.display = t ? 'inline-flex' : 'none';
  document.getElementById('taskModalOverlay').classList.add('active');
}
document.getElementById('addTaskBtn').addEventListener('click',()=>openTaskModal(null));
document.getElementById('saveTaskBtn').addEventListener('click', async ()=>{
  const title = document.getElementById('tTitle').value.trim();
  if(!title){ await showAlert('Please enter a task.'); return; }
  const relVal = document.getElementById('tRelated').value;
  const [relatedType, relatedId] = relVal ? relVal.split(':') : [null,null];
  const payload = { title, dueDate: document.getElementById('tDue').value,
    priority: document.getElementById('tPriority').value, relatedType, relatedId,
    recurrence: { type: document.getElementById('tRecurrence').value, interval: 1 } };
  if(editingTaskId){
    Object.assign(DATA.tasks.find(x=>x.id===editingTaskId), payload);
  } else {
    DATA.tasks.push({id:uid('t'), done:false, ...payload});
    logActivity(`Added task "${title}"`);
  }
  saveData(DATA); closeModals(); renderAll();
});
document.getElementById('deleteTaskBtn').addEventListener('click', async ()=>{
  if(!(await showConfirm('Delete this task?', { title:'Delete task', confirmLabel:'Delete', danger:true }))) return;
  DATA.tasks = DATA.tasks.filter(t=>t.id!==editingTaskId);
  saveData(DATA); closeModals(); renderAll();
});

