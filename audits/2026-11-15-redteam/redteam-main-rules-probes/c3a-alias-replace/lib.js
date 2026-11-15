const app = module.exports;
app.run = function () { return "alias-run"; };
module.exports = { run: function () { return "replaced-run"; } };
