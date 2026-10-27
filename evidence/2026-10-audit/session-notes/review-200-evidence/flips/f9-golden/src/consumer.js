import { Service } from "./service.js";
class Sub extends Service { handle(input) { console.log("L:Sub.handle"); return input; } }
new Sub().run(1);
