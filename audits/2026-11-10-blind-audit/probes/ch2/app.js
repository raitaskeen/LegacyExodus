const logger = require("./logger");
logger.format = function (msg) { return "patched " + msg; };
logger.log("hi");
