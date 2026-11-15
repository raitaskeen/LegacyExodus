var mixin = require("merge-descriptors");
var proto = require("./application");
exports = module.exports = createApplication;
function createApplication() { var app = function (req, res, next) {}; mixin(app, proto, false); return app; }
