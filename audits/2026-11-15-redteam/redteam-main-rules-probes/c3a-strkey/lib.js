module.exports = { run: function () { return "literal-run"; } };
module.exports["run"] = function () { return "string-key-run"; };
