// Assertions are eliminated by the build process when DEBUG is false
export const DEBUG = false;

export function assert(cond: any, message?: string): void {
  if (DEBUG) {
    if (!cond) {
      throw new Error(message || 'Assertion Failed!');
    }
  }
}
