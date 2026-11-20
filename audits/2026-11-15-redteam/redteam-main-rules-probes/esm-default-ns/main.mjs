import decorator from "./lib.mjs";
function make() { return { add: decorator.add }; }
const x = make();
console.log(decorator.add(), x.add());
