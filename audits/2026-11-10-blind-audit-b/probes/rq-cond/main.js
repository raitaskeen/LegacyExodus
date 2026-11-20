function pick(flag) {
  let m = require('./u');
  if (flag) m = require('./v');
  return m.f();
}
console.log('rq-cond:', pick(true));
