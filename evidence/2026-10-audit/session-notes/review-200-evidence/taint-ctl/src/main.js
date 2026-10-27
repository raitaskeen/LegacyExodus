function h(cmd) { child_process.exec(cmd); }
function lazy() { const helper = require("./helper"); return helper; }
const input = req.body.name;
h(input);
