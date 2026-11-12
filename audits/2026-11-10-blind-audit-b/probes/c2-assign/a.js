function Job(opts) { Object.assign(this, opts); }
Job.prototype.step = function () { return 'prototype'; };
const j = new Job({ step() { return 'own'; } });
console.log('c2-assign:', j.step());
