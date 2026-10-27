export default class {
  start() { console.log("L:base.start"); }
  run() {
    console.log("S:s4"); this.start();
  }
}
