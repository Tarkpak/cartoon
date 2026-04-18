export class AsrClientError extends Error {
  public readonly details?: unknown

  constructor(message: string, options: { details?: unknown } = {}) {
    super(message)
    this.name = 'AsrClientError'
    this.details = options.details
  }
}
