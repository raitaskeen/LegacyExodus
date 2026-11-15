const make = require("./a");
exports.go = function () { try { const x = make(); return x.run(); } catch (e) { return "THROWS " + e.message; } };
