function annexB() {
  if (true) { function setTimeout() { return 'repo-setTimeout'; } }
  return setTimeout();
}
function hoisted() {
  try { return JSON.stringify(1); } catch (e) { return 'throws ' + e.constructor.name; }
  var JSON = { stringify() { return 'local'; } };
}
function param(console) { return console.log('x'); }
function caught() {
  try { throw { log() { return 'catch-binding'; } }; } catch (console) { return console.log(); }
}
process.stdout.write(['gl-shadow:', annexB(), hoisted(), param({ log: () => 'param' }), caught()].join(' | ') + '\n');
