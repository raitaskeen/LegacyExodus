const inst = require("./lib");
class Sub extends inst.constructor { m() { return "Sub.m"; } }
console.log(new Sub().go());
