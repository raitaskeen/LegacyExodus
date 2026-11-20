// Each program runs as-is: `req`, `res` are provided; runtime taint = some res.send argument contains TAINT.
export const cases: Record<string, string> = {
  // --- loops ---
  "L1 for-of loop-carried (audit)": `let prev = "", cur = ""; for (const item of [1, 2]) { prev = cur; cur = req.body; } res.send(prev);`,
  "L2 while loop-carried": `let prev = "", cur = "", i = 0; while (i < 2) { prev = cur; cur = req.body; i = i + 1; } res.send(prev);`,
  "L3 classic for loop-carried": `let prev = "", cur = ""; for (let i = 0; i < 2; i++) { prev = cur; cur = req.body; } res.send(prev);`,
  "L4 do-while loop-carried": `let prev = "", cur = "", i = 0; do { prev = cur; cur = req.body; i = i + 1; } while (i < 2); res.send(prev);`,
  "L5 for-of zero iterations": `let v = req.body; for (const x of []) { v = "safe"; } res.send(v);`,
  "L6 while zero iterations": `let v = req.body; const go = false; while (go) { v = "safe"; } res.send(v);`,
  "L7 for-in zero iterations": `let v = req.body; for (const k in {}) { v = "safe"; } res.send(v);`,
  "L8 for update runs after body": `let v = "", n = ""; for (let i = 0; i < 2; v = n, i++) { n = req.body; } res.send(v);`,
  "L9 break carries state out": `let v = ""; const c = true; while (true) { if (c) { v = req.body; break; } v = "safe"; } res.send(v);`,
  "L10 continue carries state back": `let v = "", w = ""; for (const k of [1, 2]) { v = w; w = req.body; if (k === 1) continue; w = "safe"; } res.send(v);`,
  "L11 labeled break of outer loop": `let v = ""; outer: for (const a of [1]) { for (const b of [1]) { v = req.body; break outer; } v = "safe"; } res.send(v);`,
  "L12 for-of over tainted then safe": `let v = req.body; for (const x of [1]) { res.send(v); v = "safe"; }`,
  // --- switch ---
  "S1 switch tainted case then safe case (audit)": `let v = ""; const k = 1; switch (k) { case 1: v = req.body; break; case 2: v = "safe"; break; } res.send(v);`,
  "S2 switch no matching case": `let v = req.body; const k = 3; switch (k) { case 1: v = "safe"; break; } res.send(v);`,
  "S3 switch fallthrough": `let v = "", w = ""; const k = 1; switch (k) { case 1: v = req.body; case 2: w = v; break; case 3: w = "safe"; } res.send(w);`,
  "S4 switch case skipped into default": `let v = req.body; const k = 9; switch (k) { case 1: v = "safe"; break; default: res.send(v); }`,
  // --- try ---
  "T1 try assigns, catch overwrites (audit)": `let v = ""; function mayThrow() {} try { v = req.body; mayThrow(); } catch (e) { v = "fallback"; } res.send(v);`,
  "T2 catch sees intermediate state": `let v = "", w = ""; function mayThrow() { throw new Error("x"); } try { v = req.body; mayThrow(); v = "safe"; } catch (e) { w = v; } res.send(w);`,
  "T3 catch sees pre-try state": `let v = req.body; function mayThrow() { throw new Error("x"); } try { mayThrow(); v = "safe"; } catch (e) { res.send(v); }`,
  "T4 finally after throw": `let v = req.body; function mayThrow() { throw new Error("x"); } try { try { mayThrow(); v = "safe"; } finally { res.send(v); } } catch (e) {}`,
  // --- conditional expressions (same root cause: only IfStatement joins) ---
  "E1 logical && skips assignment": `let v = req.body; const c = false; c && (v = "safe"); res.send(v);`,
  "E2 conditional expression": `let v = req.body; const c = false; c ? (v = "safe") : 0; res.send(v);`,
  "E3 logical assignment ??=": `let v = req.body; v ??= "safe"; res.send(v);`,
  "E4 logical assignment ||=": `let v = req.body; v ||= "safe"; res.send(v);`,
  // --- controls: must stay as today ---
  "C1 straight-line overwrite (no flow)": `let v = req.body; v = "safe"; res.send(v);`,
  "C2 if/else join (flow)": `let v = ""; const c = true; if (c) { v = req.body; } else { v = "safe"; } res.send(v);`,
  "C3 loop body sanitizes before use (no flow)": `for (const x of [1, 2]) { let v = req.body; v = "safe"; res.send(v); }`,
};
