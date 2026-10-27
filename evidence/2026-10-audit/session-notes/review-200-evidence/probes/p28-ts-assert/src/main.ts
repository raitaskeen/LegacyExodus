class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
let x: any = new A();
function swap() { (x as any) = new B(); }
swap();
console.log("S:ts-as"); x.m();
let y: any = new A();
function swap2() { y! = new B(); }
swap2();
console.log("S:ts-bang"); y.m();
