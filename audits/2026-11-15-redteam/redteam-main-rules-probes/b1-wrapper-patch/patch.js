require("./myfs").readFileSync = function () { return "patched-through-wrapper"; };
