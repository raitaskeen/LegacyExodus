class Logger {
  log(msg) { return this.format(msg); }
  format(msg) { return "[log] " + msg; }
}
module.exports = new Logger();
