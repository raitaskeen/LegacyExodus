var EventEmitter = require("events").EventEmitter;
function createApplication() {
  var app = function () {};
  Object.assign(app, EventEmitter.prototype);
  return app;
}
module.exports = createApplication;
