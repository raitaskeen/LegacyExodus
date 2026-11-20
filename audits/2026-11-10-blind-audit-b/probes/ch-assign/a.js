'use strict';
class Job {
  constructor(opts) { Object.assign(this, opts); }
  run() { return this.step(); }
  step() { return 'default'; }
}
const j = new Job({ step() { return 'injected'; } });
console.log('ch-assign:', j.run());
