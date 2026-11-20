function make() { const o = { run() { return "literal-run"; } }; return o; }
const x = make();
x["run"] = function () { return "patched-by-string-key"; };
console.log(x.run());
