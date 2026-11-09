class Base {
  run() { return this.helper(); }
  helper() { return "base"; }
}
class Public extends Base {}
module.exports = { Public };
