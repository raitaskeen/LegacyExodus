function add() { return "declared-add"; }
exports.add = add;
exports["add"] = function () { return "replaced-by-string-key"; };
