function F(opts) { this.init(opts); }
F.prototype.init = function (opts) { Object.assign(this, opts); };
F.prototype.m = function () { return "F.m"; };
const x = new F({ m: function () { return "own-m-from-opts"; } });
console.log(x.m());
