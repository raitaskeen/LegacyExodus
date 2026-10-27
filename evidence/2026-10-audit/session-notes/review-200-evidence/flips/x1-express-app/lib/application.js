var app = exports = module.exports = {};
app.init = function init() {
  console.log("S:gt-default-config"); this.defaultConfiguration();
};
app.defaultConfiguration = function defaultConfiguration() { console.log("L:app.defaultConfiguration"); };
app.lazyrouter = function lazyrouter() { console.log("L:app.lazyrouter"); };
app.use = function use(fn) {
  console.log("S:gt-lazyrouter"); this.lazyrouter();
};
