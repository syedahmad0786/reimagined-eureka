declare module 'cubejs' {
  export default class Cube {
    constructor(other?: Cube);
    static initSolver(): void;
    static fromString(facelets: string): Cube;
    static random(): Cube;
    static inverse(alg: string): string;
    move(alg: string): this;
    asString(): string;
    isSolved(): boolean;
    solve(maxDepth?: number): string;
    toJSON(): { center: number[]; cp: number[]; co: number[]; ep: number[]; eo: number[] };
  }
}
