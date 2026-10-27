const app = {};
app.defaultConfiguration = function() { console.log("L:app.defaultConfiguration"); };
app.init = function() {
  console.log("S:rri"); this.defaultConfiguration();
};
app.init.call({ defaultConfiguration() { console.log("L:other.defaultConfiguration"); } });
