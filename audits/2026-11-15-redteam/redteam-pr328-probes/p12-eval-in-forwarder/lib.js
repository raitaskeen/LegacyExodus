function realUse() { console.log("REAL use"); }
function createApplication() {
  var app = { use: realUse };
  return app;
}
module.exports = createApplication;
