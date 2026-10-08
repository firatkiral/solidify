declare module "*.jpg" {
    const value: string;
    export default value;
}

declare module "*.exr" {
    const value: string;
    export default value;
}

declare module "*.png" {
    const value: string;
    export default value;
}

declare module "*.svg" {
    const value: string;
    export default value;
}

declare module "dot-solidify" {
    const value: string;
    export default value;
}
// Vite gives the URL of a file imported with ?url
declare module "*?url" {
    const value: string;
    export default value;
}
