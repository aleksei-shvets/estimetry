/** Finds executables the installed hooks will call. */
export interface CommandLocator {
  has(name: string): boolean;
}
