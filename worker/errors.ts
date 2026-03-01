export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function assert(condition: unknown, message: string, status: number, code?: string): asserts condition {
  if (!condition) {
    throw new AppError(message, status, code);
  }
}
