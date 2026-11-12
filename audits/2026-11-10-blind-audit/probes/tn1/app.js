const express = require("express");
const fs = require("fs");
const { execSync } = require("child_process");
const escapeHtml = require("escape-html");
const app = express();
app.get("/file", (req, res) => {
  res.send(fs.readFileSync(escapeHtml(req.query.name), "utf8"));
});
app.get("/run", (req, res) => {
  res.send(String(execSync(escapeHtml(req.query.cmd))));
});
app.get("/raw", (req, res) => {
  res.send(fs.readFileSync(req.query.name, "utf8"));
});
module.exports = app;
