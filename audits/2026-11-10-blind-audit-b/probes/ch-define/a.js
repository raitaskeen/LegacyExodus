'use strict';
class Job {
  constructor(fn) { Object.defineProperty(this, 'step', { value: fn }); }
  run() { return this.step(); }
  step() { return 'default'; }
}
const j = new Job(() => 'injected');
console.log('ch-define:', j.run());
