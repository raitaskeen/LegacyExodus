function run() { return "top-run"; }
if (true) { function run() { return "block-run"; } }
console.log(run());
