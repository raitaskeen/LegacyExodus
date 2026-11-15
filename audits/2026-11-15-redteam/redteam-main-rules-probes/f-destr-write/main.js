function make() { const o = { run() { return "literal-run"; } }; return o; }
const x = make();
[x.run] = [function () { return "patched-by-destructuring"; }];
console.log(x.run());
