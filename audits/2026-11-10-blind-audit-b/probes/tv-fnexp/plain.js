const cp = require('child_process');
exports.runPlain = function runPlain(cmd) { return cp.execSync(cmd); };
