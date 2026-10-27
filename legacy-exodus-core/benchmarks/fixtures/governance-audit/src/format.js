export function pad(text, width) {
  let result = String(text);
  while (result.length < width) {
    result = " " + result;
  }
  return result;
}

export function formatResult(label, value) {
  return label + ": " + pad(value, 6);
}
