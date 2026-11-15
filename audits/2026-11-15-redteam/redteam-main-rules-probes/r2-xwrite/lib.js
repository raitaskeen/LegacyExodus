const app = {};
app.init = function () { return "init"; };
app.start = function () { return app.init(); };
module.exports = app;
