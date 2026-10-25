const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'x-adblock.js'), 'utf8');
const plugin = fs.readFileSync(path.join(__dirname, '..', 'X-AdBlock.plugin'), 'utf8');
const pattern = new RegExp(plugin.match(/^http-response (\S+) /m)[1]);
const url = 'https://x.com/i/api/graphql/rotating-id/HomeTimeline?variables=test';
let tests = 0;
function run(body, requestUrl = url) {
  let output, calls = 0;
  vm.runInNewContext(source, {
    $request: { url: requestUrl }, $response: { body },
    $done(value) { calls++; output = value; }, console: { log() {} }
  }, { timeout: 1000 });
  assert.equal(calls, 1);
  return JSON.parse(JSON.stringify(output));
}
function check(name, callback) {
  callback(); tests++; console.log('PASS ' + name);
}
const tweet = (id, more = {}) => ({ entryId: id, content: { itemContent: more } });
const cursor = { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: 'next' } };
const wrap = entries => ({ data: { home: { instructions: [{ type: 'TimelineAddEntries', entries }] } } });
const entries = data => data.data.home.instructions[0].entries;
const clean = data => JSON.parse(run(JSON.stringify(data)).body);

check('metadata ads removed, normal tweet and cursor preserved', () => {
  const normal = tweet('tweet-1', { tweet_results: { result: { legacy: { full_text: '讨论广告 Sponsored' } } } });
  const output = clean(wrap([normal, tweet('tweet-ad', { promotedMetadata: {} }), cursor]));
  assert.deepEqual(entries(output), [normal, cursor]);
});
check('promoted entry IDs removed', () => {
  assert.deepEqual(entries(clean(wrap([tweet('promoted-tweet-1'), tweet('promoted_2'), cursor]))), [cursor]);
});
check('snake case marker supported', () => {
  assert.deepEqual(entries(clean(wrap([{ entry_id: 'a', content: { itemContent: { promoted_metadata: {} } } }, cursor]))), [cursor]);
});
check('mixed module keeps organic items', () => {
  const organic = { entryId: 'tweet-2', item: { itemContent: { text: 'normal' } } };
  const module = { entryId: 'module-1', content: { entryType: 'TimelineTimelineModule', items: [
    organic, { entryId: 'ad-1', item: { itemContent: { promotedMetadata: {} } } }
  ] } };
  assert.deepEqual(entries(clean(wrap([module, cursor])))[0].content.items, [organic]);
});
check('module emptied by filtering removed', () => {
  const module = { entryId: 'module-1', content: { __typename: 'TimelineTimelineModule', items: [tweet('promoted-1')] } };
  assert.deepEqual(entries(clean(wrap([module, cursor]))), [cursor]);
});
check('moduleItems instructions supported', () => {
  const normal = { item: { itemContent: { text: 'normal' } } };
  const data = { instructions: [{ type: 'TimelineAddToModule', moduleItems: [tweet('promoted-1'), normal] }] };
  assert.deepEqual(clean(data).instructions[0].moduleItems, [normal]);
});
check('single promoted replacement removed', () => {
  const data = { instructions: [{ type: 'TimelineReplaceEntry', entry: tweet('promoted-1') }, { type: 'TimelineTerminateTimeline' }] };
  assert.deepEqual(clean(data).instructions, [{ type: 'TimelineTerminateTimeline' }]);
});
check('quoted promoted metadata never removes its organic parent', () => {
  const data = wrap([tweet('tweet-1', { tweet_results: { result: { quoted_status_result: { result: { promotedMetadata: {} } } } } })]);
  assert.deepEqual(run(JSON.stringify(data)), {});
});
check('unchanged response returned without reserialization', () => {
  assert.deepEqual(run('  ' + JSON.stringify(wrap([tweet('tweet-1'), cursor]))), {});
});
check('false or null metadata not treated as advertising', () => {
  assert.deepEqual(run(JSON.stringify(wrap([tweet('tweet-1', { promotedMetadata: null }), tweet('tweet-2', { promotedMetadata: false })]))), {});
});
check('invalid, empty, binary and primitive bodies pass through', () => {
  for (const value of ['', '<html>error</html>', '{broken', null, new Uint8Array([1]), 'null', '42']) {
    assert.deepEqual(run(value), {});
  }
});
check('unknown schema and errors pass through', () => {
  assert.deepEqual(run(JSON.stringify({ errors: [{ message: 'error' }], unknown: { promotedMetadata: {} } })), {});
});
check('plugin and script route matching agree', () => {
  const body = JSON.stringify(wrap([tweet('promoted-1'), cursor]));
  const yes = [url, 'https://api.twitter.com/graphql/id/HomeTimeline', 'https://api.x.com/2/timeline/home.json',
    'https://mobile.twitter.com/i/api/graphql/id/SearchTimeline', 'https://www.x.com/i/api/2/timeline/home.json'];
  const no = ['https://x.com.evil.test/i/api/graphql/id/a', 'https://evil.test/i/api/graphql/id/a',
    'https://x.com/i/api/graphqlish/a', 'https://x.com/i/api/1.1/account/settings.json', 'https://pbs.twimg.com/a.jpg'];
  for (const candidate of yes) {
    assert.equal(pattern.test(candidate), true, candidate);
    assert.ok(run(body, candidate).body, candidate);
  }
  for (const candidate of no) {
    assert.equal(pattern.test(candidate), false, candidate);
    assert.deepEqual(run(body, candidate), {}, candidate);
  }
});
check('filter is idempotent', () => {
  const output = run(JSON.stringify(wrap([tweet('promoted-1'), cursor])));
  assert.deepEqual(run(output.body), {});
});
console.log(`${tests} tests passed. Synthetic fixtures only; device verification pending.`);
