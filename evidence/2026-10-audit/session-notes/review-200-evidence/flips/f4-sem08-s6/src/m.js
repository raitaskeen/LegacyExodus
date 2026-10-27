module.exports.setup = function() { console.log("L:exports.setup"); };
module.exports.init = function() {
  console.log("S:s6"); this.setup();
};
