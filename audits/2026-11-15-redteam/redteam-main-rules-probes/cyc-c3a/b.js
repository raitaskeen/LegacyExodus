const a = require("./a");
exports.go = function () { try { return a.run(); } catch (e) { return "THROWS " + e.message; } };
