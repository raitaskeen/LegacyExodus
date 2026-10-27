var app = module.exports = {};
app.defaultConfiguration = function() { console.log("L:app.defaultConfiguration"); };
app.init = function() {
  console.log("S:dcr-s5"); this.defaultConfiguration();
};
