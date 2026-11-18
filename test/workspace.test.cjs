const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  .replace('boot();setInterval(updateTimeSensitiveStatuses,15000);', '');

function workspace(elements = {}, globals = {}) {
  const context = vm.createContext({
    document: { querySelector: key => elements[key], addEventListener() {} },
    window: { addEventListener() {} },
    ...globals
  });
  vm.runInContext(source, context);
  return code => vm.runInContext(code, context);
}

test('replacing an import disables submit and ignores an older read', async () => {
  const input = { files: [] };
  const submit = { disabled: false };
  const feedback = {};
  const preview = {};
  const run = workspace({
    '#schedule-file': input, '#confirm-import': submit, '#import-feedback': feedback,
    '#import-preview': preview, '#dialog': { open: true }
  }, { input });
  run('api=async()=>({errors:[]})');
  const csv = 'building,room,instructor,course,days,startTime,endTime\nNorth,201,Ada,Networks,Mon,08:00,09:00';

  input.files = [{ name: 'valid.csv', text: async () => csv }];
  await run('readImport({ target: input })');
  assert.equal(submit.disabled, false);

  let finishReading;
  input.files = [{ name: 'slow.csv', text: () => new Promise(resolve => { finishReading = resolve; }) }];
  const oldRead = run('readImport({ target: input })');
  assert.equal(submit.disabled, true);
  input.files = [{ name: 'replacement.xls' }];
  await run('readImport({ target: input })');
  finishReading(csv);
  await oldRead;
  assert.equal(submit.disabled, true);
  assert.equal(run('s.importRows.length'), 0);
  assert.match(feedback.innerHTML, /Choose an/);
});

test('attaching a photo updates the preview without recreating the check form', async () => {
  const input = { files: [{ size: 12 }] };
  const preview = { removeAttribute() {} };
  const submit = {};
  const form = { notes: 'HDMI works', pcInUse: 'yes' };
  const run = workspace({
    '#check-photo': input, '#check-photo-preview': preview, '[form="check-form"]': submit,
    '#check-form': form, '#dialog': { open: true }
  }, {
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/png;base64,AA=='; this.onload(); }
    },
    input
  });
  run('let dialogCalls=0; dialog=()=>dialogCalls++; checkForm({room:{},building:{},schedule:{}}, false)');
  await run('$("#check-photo").onchange({ target: input })');
  assert.equal(run('dialogCalls'), 1);
  assert.equal(preview.hidden, false);
  assert.equal(preview.src, 'data:image/png;base64,AA==');
  assert.equal(form.notes, 'HDMI works');
  assert.equal(form.pcInUse, 'yes');
  assert.equal(submit.disabled, false);
});

test('refresh coalesces a burst, serializes its follow-up, and reloads on date change', async () => {
  const requests = [];
  const timers = new Map();
  const modal = { open: false };
  let timerId = 0;
  const run = workspace({ '#dialog': modal }, {
    fetchState: url => new Promise(resolve => { requests.push({ url, resolve }); }),
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  const state = { user: { id: 'staff' }, audit: [], rounds: [] };
  const flush = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
  run('s.user={id:"staff"}; api=fetchState; render=()=>{}; queueRefresh(); queueRefresh(); queueRefresh()');
  assert.equal(timers.size, 1);
  flush();
  const work = run('refreshWork');
  modal.open = true;
  run('queueRefresh(); queueRefresh()');
  assert.equal(requests.length, 1);
  modal.open = false;
  requests[0].resolve(state);
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  requests[1].resolve(state);
  await work;
  assert.equal(timers.size, 0);
  run('s.loadedDate="2000-01-01"; updateTimeSensitiveStatuses()');
  assert.equal(timers.size, 1);
  flush();
  const dateWork = run('refreshWork');
  assert.equal(requests[2].url, requests[0].url);
  requests[2].resolve(state);
  await dateWork;
  assert.equal(run('s.loadedDate===today()'), true);
});

test('open issue pages can display and resolve a round outside of check history', () => {
  const run = workspace();
  const markup = run(`
    s.user={role:"admin"};
    s.issuePage=0;
    s.data={history:[],openIssues:{page:0,hasMore:false,rounds:[{
      id:"old-round", date:"2025-01-01", building:{name:"North"}, room:{name:"Lab"},
      schedule:{course:"Networks"},openIssues:["Display damaged"]
    }]}};
    openIssuesPage();
  `);
  assert.match(markup, /Display damaged/);
  assert.match(markup, /data-action="resolve" data-id="old-round"/);
  assert.doesNotMatch(run('s.user.role="staff"; openIssuesPage()'), /data-action="resolve"/);
});

test('planner suggests distinct saved values for each text field', () => {
  const run = workspace();
  const suggestions = run(`
    s.data={schedules:[
      {instructor:"Ada Reyes",course:"Networks & Systems",section:"3A"},
      {instructor:" ada reyes ",course:"Programming",section:""}
    ]};
    plannerSuggestions();
  `);
  assert.match(suggestions, /id="planner-instructor-suggestions"><option value="Ada Reyes"><\/option><\/datalist>/);
  assert.match(suggestions, /id="planner-course-suggestions"><option value="Networks &amp; Systems">/);
  assert.match(suggestions, /id="planner-section-suggestions"><option value="3A"><\/option><\/datalist>/);
  const slot = run('plannerDraftMarkup(plannerDraft(), 0)');
  for (const field of ['instructor', 'course', 'section']) {
    assert.match(slot, new RegExp('list="planner-' + field + '-suggestions"'));
  }
  assert.match(slot, /type="button" data-action="clear-planner-days" data-index="0"/);
});

test('typing updates the draft and Unselect all clears only that slot', async () => {
  const app = { querySelectorAll: () => [] };
  const dayInputs = [{ checked: true }, { checked: true }];
  const input = {
    dataset: { plannerIndex: '1', plannerField: 'instructor' },
    value: 'Ada Reyes',
    matches: selector => selector === '[data-planner-index][data-planner-field]',
    closest: () => null
  };
  const button = {
    dataset: { action: 'clear-planner-days', index: '1' },
    closest: () => ({ querySelectorAll: () => dayInputs })
  };
  const run = workspace({ '#app': app }, { input, button });
  assert.equal(run('plannerDraft().days.length'), 0);
  run('s.schedulePlanner.drafts=[{...plannerDraft(),days:[1,3,5]},{...plannerDraft(),days:[2,4]}]; bind(); app.oninput({target:input})');
  await run('app.onclick({target:{closest:selector=>selector==="[data-action]"?button:null}})');
  assert.equal(run('s.schedulePlanner.drafts[1].instructor'), 'Ada Reyes');
  assert.equal(run('s.schedulePlanner.drafts[0].days.join(",")'), '1,3,5');
  assert.equal(run('s.schedulePlanner.drafts[1].days.length'), 0);
  assert.ok(dayInputs.every(day => !day.checked));
});

test('import preview checks every row before allowing a save', async () => {
  const input = { files: [{ name: 'rooms.csv', text: async () =>
    'building,room,instructor,course,days,startTime,endTime\nNorth,201,Ada,Networks,Mon,08:00,09:00\n\nNorth,201,Sam,Programming,Mon,08:30,09:30' }] };
  const submit = {};
  const feedback = {};
  const preview = {};
  const run = workspace({
    '#schedule-file': input, '#confirm-import': submit, '#import-feedback': feedback,
    '#import-preview': preview, '#dialog': { open: true }
  }, { input });
  run(`let request; api=async (url, options)=>{
    request=JSON.parse(options.body);
    return {errors:[{row:4,error:"Overlapping schedule"}]};
  }`);
  await run('readImport({target:input})');
  assert.equal(run('request.preview'), true);
  assert.equal(run('request.rows[1].sourceRow'), 4);
  assert.equal(submit.disabled, true);
  assert.match(preview.innerHTML, /North \/ 201: 2/);
  assert.match(preview.innerHTML, /<td>4<\/td>.*Overlapping schedule/);
});

test('cancelling planner entry clears the draft and keeps the current location', async () => {
  const app = { querySelectorAll: () => [] };
  const building = { focus() { this.focused = true; } };
  const button = { dataset: { action: 'cancel-planner-draft' }, form: { dataset: { pending: 'true' } } };
  const run = workspace({ '#app': app, '[data-planner-building]': building }, { button });
  run('Object.assign(s.schedulePlanner,{buildingId:"b",roomId:"r",drafts:[plannerDraft()]}); render=()=>{}; bind()');
  const click = 'app.onclick({target:{closest:selector=>selector==="[data-action]"?button:null}})';
  await run(click);
  assert.equal(run('s.schedulePlanner.drafts.length'), 1);
  delete button.form.dataset.pending;
  await run(click);
  assert.equal(run('s.schedulePlanner.drafts.length'), 0);
  assert.equal(run('s.schedulePlanner.buildingId + "/" + s.schedulePlanner.roomId'), 'b/r');
  assert.equal(building.focused, true);
});
