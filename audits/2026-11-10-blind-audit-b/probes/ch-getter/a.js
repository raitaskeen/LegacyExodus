'use strict';
function other() { return 'returned-fn'; }
class A {
  get m() { return other; }
  run() { return this.m(); }
}
console.log('ch-getter:', new A().run());
