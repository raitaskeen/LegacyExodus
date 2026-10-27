import Base from "./a.js";
class Sub extends Base { start() { console.log("L:sub.start"); } }
new Sub().run();
