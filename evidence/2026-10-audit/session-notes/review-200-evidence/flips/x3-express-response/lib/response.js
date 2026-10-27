var http = require("http");
var res = Object.create(http.ServerResponse.prototype);
module.exports = res;
res.set = function header(field, val) { console.log("L:res.set"); return this; };
res.get = function (field) { console.log("L:res.get"); return undefined; };
res.json = function json(obj) {
  console.log("S:gt-res-get"); var type = this.get("Content-Type");
  console.log("S:gt-res-set"); this.set("Content-Type", "application/json");
  return this;
};
