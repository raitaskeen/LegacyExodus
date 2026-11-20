const path = require('path');
const p = path;
p.join = function () { return 'repo-join'; };
