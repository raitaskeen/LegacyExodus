const express = require('express');
const { runPlain } = require('./plain');
const app = express();
app.get('/p', (req, res) => { runPlain(req.query.p); res.end(); });
