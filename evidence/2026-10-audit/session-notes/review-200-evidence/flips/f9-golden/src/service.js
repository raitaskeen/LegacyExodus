export class Service {
  handle(input) { console.log("L:Service.handle"); return input; }
  run(input) { console.log("S:golden"); return this.handle(input); }
}
