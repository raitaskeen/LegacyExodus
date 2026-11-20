function load() {
  var m;
  try { m = require('./missing'); } catch (e) { m = require('./v'); }
  return m.f();
}
console.log('rq-try:', load());
