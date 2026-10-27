function h(cmd) { child_process.exec(cmd); }
function lazy() { const h = require("./helper"); return h; }
const input = req.body.name;
h(input);
