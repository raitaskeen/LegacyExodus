const cp = require('child_process');
module.exports = { runPlain(cmd) { return cp.execSync(cmd); } };
