function load(flag) {
  if (flag) { var u = require('./u'); }
  return u.f();
}
try { console.log('rq-var:', load(false)); } catch (e) { console.log('rq-var throws:', e.constructor.name); }
