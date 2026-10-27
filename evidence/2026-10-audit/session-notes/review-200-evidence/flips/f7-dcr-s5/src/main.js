const proto = require("./application");
const target = function () {};
target.defaultConfiguration = function () { console.log("L:target.defaultConfiguration"); };
target.init = proto.init;
target.init();
