export class AuteurError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AuteurError";
  }
}

export class JsonParseError extends AuteurError {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "JsonParseError";
  }
}

export class SchemaValidationError extends AuteurError {
  constructor(message: string, readonly issues: unknown) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export class ModelCallError extends AuteurError {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = "ModelCallError";
  }
}
