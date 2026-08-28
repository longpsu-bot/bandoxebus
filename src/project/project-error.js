export class ProjectLoadError extends Error {
  constructor(code, path, message, { cause } = {}) {
    super();
    Object.defineProperty(this, 'name', {
      configurable: true,
      value: 'ProjectLoadError',
      writable: true
    });
    this.code = code;
    this.path = path;
    this.message = message;
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        value: cause,
        writable: true
      });
    }
  }
}

export function projectError(code, issue, options) {
  return new ProjectLoadError(code, issue.path, issue.message, options);
}
