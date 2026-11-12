'use strict';
const other = { m() { return 'other'; } };
class A {
  run() { return [1].map(function () { return this.m(); }, other); }
  m() { return 'A'; }
}
console.log('ch-thisarg:', new A().run());
