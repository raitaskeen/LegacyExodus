function realUse() { console.log("REAL use"); }
function fakeUse() { console.log("FAKE use"); }
function createApp() { return { use: realUse, extra: 1 }.use && makeOther(); }
function makeOther() { var o = {}; o.use = realUse; return o; }
function unused() {
  function createApp() { var o = { use: fakeUse }; return o; }
  return createApp;
}
module.exports = createApp;
