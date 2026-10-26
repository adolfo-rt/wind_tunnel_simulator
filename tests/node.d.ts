/**
 * The two pieces of Node that the test suite touches.
 *
 * The application is a browser bundle and nothing in `src/` reads or writes a file, so
 * the project deliberately carries no `@types/node`. One test - the cruise dataset
 * generator - has to write its output, and one reads an environment variable to know
 * whether it is generating or verifying. Declaring exactly those two is cheaper and
 * clearer than adding a type package the rest of the project would never use.
 */

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}

declare const process: { env: Record<string, string | undefined> };
