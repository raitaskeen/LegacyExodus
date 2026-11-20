function F() {}
F.prototype.m = function () { return "F.m"; };
module.exports = new F();
