import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8');

function load({ gtag } = {}) {
  const listeners = {};
  const tier = (name, price) => ({
    querySelector: (selector) => selector === '.tier__name'
      ? { textContent: ` ${name} ` }
      : { firstChild: { textContent: price } },
  });
  const document = {
    readyState: 'complete',
    addEventListener: (name, handler) => { listeners[name] = handler; },
    querySelectorAll: (selector) => selector === '.tier' ? [tier('Starter', '$200'), tier('Scale', '$1,000')] : [],
    getElementById: () => null,
    documentElement: { scrollHeight: 2000 },
  };
  const window = { gtag };
  vm.runInNewContext(source, { window, document, addEventListener() {}, URL });
  return { api: window.cmoAnalytics, listeners };
}

test('links map to funnel events', () => {
  const mapped = load().api.linkEvent;
  const linkEvent = (...args) => JSON.parse(JSON.stringify(mapped(...args)));
  assert.deepEqual(linkEvent('https://app.cmo.xyz/signup', 'hero'), ['sign_up_start', { cta_location: 'hero' }]);
  assert.deepEqual(linkEvent('https://app.cmo.xyz/login', 'nav_login'), ['login_start', { cta_location: 'nav_login' }]);
  assert.deepEqual(linkEvent('https://cal.com/patricktobler', 'final_call'), ['schedule_call', { cta_location: 'final_call' }]);
  assert.deepEqual(linkEvent('mailto:business@utxo.ag'), ['contact_click', { cta_location: 'inline' }]);
  assert.deepEqual(linkEvent('#pricing'), ['nav_click', { nav_target: 'pricing', cta_location: 'inline' }]);
  assert.equal(linkEvent('/privacy'), null);
  assert.equal(linkEvent('https://www.google.com/preferences/source?q=cmo.xyz'), null);
});

test('plans read as GA4 items with numeric prices', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(load().api.plans())), [
    { item_id: 'starter', item_name: 'Starter', item_category: 'plan', item_variant: 'month', price: 200, index: 0 },
    { item_id: 'scale', item_name: 'Scale', item_category: 'plan', item_variant: 'month', price: 1000, index: 1 },
  ]);
});

test('clicks send nothing without consent and send the event with it', () => {
  const link = (href, cta) => ({ closest: () => ({ dataset: { cta }, textContent: 'Try Cuso free', href, getAttribute: () => href }) });
  assert.doesNotThrow(() => load().listeners.click({ target: link('https://app.cmo.xyz/signup', 'hero') }));
  const sent = [];
  load({ gtag: (...args) => sent.push(args) }).listeners.click({ target: link('https://app.cmo.xyz/signup', 'hero') });
  assert.deepEqual(sent.map((args) => args[1]), ['cta_click', 'sign_up_start']);
});
