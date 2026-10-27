const app = {};
app.format = function() { console.log("L:app.format"); };
app.init = function() {
  const arrow = () => { console.log("S:s5-arrow"); this.format(); };
  arrow();
  console.log("S:s5-direct"); this.format();
};
app.init.call({ format() { console.log("L:other.format"); } });
