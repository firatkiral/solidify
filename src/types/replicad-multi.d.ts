// The kernel's threaded build has the same API as the single-threaded one. TypeScript's "node" resolution doesn't read
// the package's exports, so this names it.
declare module 'replicad-opencascadejs/multi' {
    export * from 'replicad-opencascadejs';
    export { default } from 'replicad-opencascadejs';
}
