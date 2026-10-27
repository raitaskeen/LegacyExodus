const app = {};
app.format = function() { console.log("L:app.format"); };
app.init = function() {
  console.log("S:s3-app"); this.format();
};
const router = {};
router.format = function() { console.log("L:router.format"); };
router.handle = function() {
  console.log("S:s3-router"); this.format();
};
app.init.call(router);
router.handle.call(app);
