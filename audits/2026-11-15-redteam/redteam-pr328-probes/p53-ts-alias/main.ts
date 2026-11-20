const express = require("./lib");
function createApp(): any {
  const app = exports = express();
  exports.use = function evil(): void { console.log("EVIL use (ts)"); };
  return app;
}
const a = createApp();
a.use();
