// Domain errors thrown by the service layer. Services never touch reply
// objects or HTTP status codes directly - they throw one of these, and the
// central error handler (lib/errorHandler.ts) translates it into the HTTP
// response. This keeps business rules testable and reusable outside of a
// Fastify handler, while every route still returns consistent error bodies.
export class DomainError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }

  // Default JSON body. Subclasses override this when the frontend needs more
  // than a human-readable message (see TenantHasUsersError).
  toResponse(): Record<string, unknown> {
    return { error: this.message };
  }
}

export class BadRequestError extends DomainError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409);
  }
}

// Machine-readable on purpose: the frontend switches on the literal
// TENANT_HAS_USERS code to escalate into its "double confirmation"
// cascade-delete dialog, and shows userCount in that dialog's copy.
export class TenantHasUsersError extends DomainError {
  constructor(readonly userCount: number) {
    super('TENANT_HAS_USERS', 409);
  }

  override toResponse(): Record<string, unknown> {
    return { error: this.message, userCount: this.userCount };
  }
}
