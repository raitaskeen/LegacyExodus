class Service {
  handle(input) { return input; }
  run(input) { return this.handle(input); }
}
const service = new Service();
service.run(1);
