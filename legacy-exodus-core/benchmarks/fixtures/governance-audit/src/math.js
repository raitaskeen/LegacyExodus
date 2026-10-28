export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}

export function square(value) {
  return multiply(value, value);
}

export function sumOf(values) {
  let total = 0;
  for (const value of values) {
    total = add(total, value);
  }
  return total;
}
