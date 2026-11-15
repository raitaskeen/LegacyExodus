function F() {}
F.prototype.m = function () { return "F.m"; };
const x = new F();
x["m"] = function () { return "own-m-by-string-key"; };
console.log(x.m());
