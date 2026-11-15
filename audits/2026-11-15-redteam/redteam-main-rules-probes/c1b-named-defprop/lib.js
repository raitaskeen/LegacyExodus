function add() { return "declared-add"; }
exports.add = add;
Object.defineProperty(exports, "add", { value: function () { return "replaced-by-defineProperty"; } });
