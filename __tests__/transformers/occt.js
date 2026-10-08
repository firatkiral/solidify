// Jest 27 can't run the OpenCascade loader as an ES module, so it is rewritten as CommonJS for the tests.
module.exports = {
    process(source) {
        return source
            .replace('const {createRequire:a}=await import("node:module");var require=a(import.meta.url)', '')
            .replace(/import\.meta\.url/g, 'require("url").pathToFileURL(__filename).href')
            .replace(/require\("node:(\w+)"\)/g, 'require("$1")')
            .replace(/export default Module;\s*$/, 'module.exports = Module;');
    },
};
