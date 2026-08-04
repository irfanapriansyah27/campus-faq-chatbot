export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export class ProviderError extends AppError {
  constructor(message, cause) {
    super(message, { status: 503, code: 'AI_PROVIDER_ERROR', cause });
    this.name = 'ProviderError';
  }
}

export class RepositoryError extends AppError {
  constructor(message, cause) {
    super(message, { status: 503, code: 'FAQ_REPOSITORY_ERROR', cause });
    this.name = 'RepositoryError';
  }
}

