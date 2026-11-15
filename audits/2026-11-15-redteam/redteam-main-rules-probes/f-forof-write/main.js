function make() { const o = { run() { return "literal-run"; } }; return o; }
const x = make();
for (x.run of [function () { return "patched-by-for-of"; }]);
console.log(x.run());
