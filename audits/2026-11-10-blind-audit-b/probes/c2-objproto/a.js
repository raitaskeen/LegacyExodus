function F() {}
const f = new F();
console.log('c2-objproto:', f.toString());
F.prototype.toString = function () { return 'F.toString'; };
