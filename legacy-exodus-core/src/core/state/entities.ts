export interface SourceFile {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  readonly hash: string;
}

export interface Dependency {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

export interface Artifact {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
}
