const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('list controls store their value under the rendered list ID', () => {
  const match = source.match(/function updateListControl\(e\)\{[^\r\n]+\}/);
  assert.ok(match, 'updateListControl must exist as a single function');

  const s = { lists: { schedules: { state: 'all', sort: 'time_asc', search: '' } } };
  let selector;
  let rendered = false;
  const control = {
    dataset: { listControl: 'schedules', key: 'state' },
    value: 'paused',
    closest() { return this; },
    focus() { this.focused = true; }
  };
  const app = { querySelector(value) { selector = value; return control; } };
  const update = vm.runInNewContext(`${match[0]}; updateListControl`, {
    s,
    app,
    render() { rendered = true; }
  });

  update({ target: control });

  assert.equal(s.lists.schedules.state, 'paused');
  assert.equal(rendered, true);
  assert.equal(selector, '[data-list-control="schedules"][data-key="state"]');
  assert.equal(control.focused, true);
  assert.ok(/app\.oninput=e=>[^\r\n]+updateListControl\(e\)/.test(source), 'input delegates to list controls');
  assert.ok(/app\.onchange=e=>[^\r\n]+updateListControl\(e\)/.test(source), 'change delegates to list controls');
});
