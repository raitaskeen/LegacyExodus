var setPrototypeOf = Object.setPrototypeOf;
var proto = module.exports = function(options) {
  function router(req, res, next) { router.handle(req, res, next); }
  setPrototypeOf(router, proto);
  return router;
};
proto.route = function route(path) { console.log("L:proto.route"); return { get() {} }; };
proto.get = function (path) {
  console.log("S:gt-router-route"); var route = this.route(path);
  return this;
};
