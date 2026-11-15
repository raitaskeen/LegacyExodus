function F(fn) { [this.m] = [fn]; }
F.prototype.m = function () { return "F.m"; };
const x = new F(function () { return "own-m-by-destructuring"; });
console.log(x.m());
