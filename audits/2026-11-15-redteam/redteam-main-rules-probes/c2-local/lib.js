function F() {}
F.prototype.m = function () { return "F.m"; };
const x = new F();
module.exports = x;
module.exports.go = function () { return x.m(); };
