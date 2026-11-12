'use strict';
class A {
  static create() { return this.build(); }
  static build() { return 'static'; }
  build() { return 'instance'; }
}
class B {
  static make() { return this.only(); }
  only() { return 'instance-only'; }
}
console.log('ch-static:', A.create());
try { B.make(); } catch (e) { console.log('ch-static B throws:', e.constructor.name); }
