<!-- views/partials/panel-editor.ejs -->
<form id="panelForm<%= which %>" method="POST" action="/dashboard/save-panel" class="grid gap-4">
  <input type="hidden" name="which" value="<%= which %>">

  <div class="flex items-center gap-6">
    <label class="inline-flex items-center gap-2">
      <input type="radio" name="mode" value="button" <%= (panel.mode!=='dropdown')?'checked':'' %> />
      <span>Use <b>Create Button</b></span>
    </label>
    <label class="inline-flex items-center gap-2">
      <input type="radio" name="mode" value="dropdown" <%= (panel.mode==='dropdown')?'checked':'' %> />
      <span>Use <b>Dropdown Reasons</b></span>
    </label>
  </div>

  <label class="grid gap-1">
    <span>Title</span>
    <input name="title" value="<%= panel.title || '' %>" class="px-3 py-2 rounded bg-slate-800 border border-slate-700"/>
  </label>

  <label class="grid gap-1">
    <span>Body</span>
    <textarea name="body" rows="3" class="px-3 py-2 rounded bg-slate-800 border border-slate-700"><%= panel.body || '' %></textarea>
  </label>

  <div class="grid md:grid-cols-2 gap-3">
    <label class="grid gap-1">
      <span>Create Button Label</span>
      <input name="buttonLabel" value="<%= panel.buttonLabel || 'Create ticket' %>" class="px-3 py-2 rounded bg-slate-800 border border-slate-700"/>
    </label>
    <div class="grid gap-1">
      <span>Branding (shows as link button)</span>
      <div class="grid md:grid-cols-2 gap-2">
        <input name="brand_label" placeholder="Label (optional)" value="<%= panel.branding?.label || '' %>"
               class="px-3 py-2 rounded bg-slate-800 border border-slate-700"/>
        <input name="brand_url" placeholder="https://… (optional)" value="<%= panel.branding?.url || '' %>"
               class="px-3 py-2 rounded bg-slate-800 border border-slate-700"/>
      </div>
    </div>
  </div>

  <div class="grid gap-2">
    <h3 class="font-medium">Create Button — Questions (max 5)</h3>
    <div class="text-xs text-slate-400">Leave empty to have no popup. JSON is saved automatically.</div>
    <textarea name="buttonFormJson" rows="4" class="px-3 py-2 rounded bg-slate-800 border border-slate-700"><%= JSON.stringify(panel.buttonForm || [], null, 2) %></textarea>
  </div>

  <div class="grid gap-2">
    <h3 class="font-medium">Dropdown Options (used only if mode = dropdown)</h3>
    <textarea name="optionsJson" rows="6" class="px-3 py-2 rounded bg-slate-800 border border-slate-700"><%= JSON.stringify(panel.options || [], null, 2) %></textarea>
    <div class="text-xs text-slate-400">You can paste/export the structured options you already have.</div>
  </div>

  <button class="mt-2 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 w-fit">Save Panel</button>
</form>
