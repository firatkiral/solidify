// The kernel API the app was written against (lib/c3d/c3d.d.ts), implemented on OpenCascade.
// Classes and modules that are not implemented yet are stubbed: constructing a stub class or
// calling a missing module function throws an error naming exactly what is missing.

import { classes, modules } from './api';
import * as implementedClasses from './classes';
import * as implementedModules from './modules';

type AnyClass = { new(...args: any[]): any, prototype: any, name: string };

const c3d: Record<string, any> = {};

const classImpls = implementedClasses as unknown as Record<string, AnyClass>;
const moduleImpls = implementedModules as unknown as Record<string, Record<string, any>>;

const parents = new Map(classes);
function defineClass(name: string): AnyClass {
    if (c3d[name] !== undefined) return c3d[name];
    const impl = classImpls[name];
    if (impl !== undefined) {
        addAsyncVariants(impl);
        addAsyncVariants(impl.prototype);
        c3d[name] = impl;
        return impl;
    }
    const parentName = parents.get(name);
    const Parent = parentName ? defineClass(parentName) : Object;
    const stub = {
        [name]: class extends (Parent as AnyClass) {
            constructor(..._args: any[]) {
                throw new Error(`c3d.${name} is not implemented by the OCCT kernel`);
                super();
            }
        }
    }[name];
    c3d[name] = stub;
    return stub;
}
for (const [name] of classes) defineClass(name);

// Implementation-only classes (e.g. internal helpers) that are not part of the declared API are still exported.
for (const [name, impl] of Object.entries(classImpls)) {
    if (c3d[name] === undefined) { addAsyncVariants(impl); addAsyncVariants(impl.prototype); c3d[name] = impl; }
}

for (const name of modules) {
    const impl = moduleImpls[name] ?? {};
    addAsyncVariants(impl);
    c3d[name] = new Proxy(impl, {
        get(target, prop) {
            if (prop in target || typeof prop === 'symbol') return (target as any)[prop];
            return () => { throw new Error(`c3d.${name}.${String(prop)} is not implemented by the OCCT kernel`) };
        }
    });
}

// The C3D binding exposes an `X_async` variant of every function; here they simply wrap the synchronous one.
function addAsyncVariants(target: any) {
    if (target === undefined || target === null) return;
    for (const key of Object.getOwnPropertyNames(target)) {
        if (key.endsWith('_async') || key === 'constructor' || key === 'prototype') continue;
        const desc = Object.getOwnPropertyDescriptor(target, key);
        if (desc === undefined || typeof desc.value !== 'function') continue;
        const asyncKey = key + '_async';
        if (Object.prototype.hasOwnProperty.call(target, asyncKey)) continue;
        Object.defineProperty(target, asyncKey, {
            value: function (this: any, ...args: any[]) {
                try {
                    return Promise.resolve(desc.value.apply(this, args));
                } catch (e) {
                    return Promise.reject(e);
                }
            },
            writable: true, configurable: true, enumerable: false,
        });
    }
}

export default c3d;
