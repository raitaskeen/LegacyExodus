function F() {}
F.prototype.m = function () { return "F.m"; };
const x = new F();
const y = Object.create(x);
y.m = function () { return "y.m"; };
console.log(x.m());
