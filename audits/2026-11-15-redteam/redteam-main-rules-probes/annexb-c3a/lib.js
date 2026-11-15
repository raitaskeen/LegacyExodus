function run() { return "top-run"; }
if (true) { function run() { return "block-run"; } }
module.exports = { run };
