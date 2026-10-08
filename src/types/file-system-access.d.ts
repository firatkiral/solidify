// Browser APIs the app uses that this TypeScript's DOM types predate; only the parts it uses

// The File System Access API
interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
    isSameEntry(other: FileSystemHandle): Promise<boolean>;
    // Chromium only
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: 'file';
    getFile(): Promise<File>;
}

interface DataTransferItem {
    // Chromium only
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

// The Web Locks API
interface Lock {
    readonly name: string;
}

interface LockManager {
    request(name: string, options: { ifAvailable?: boolean }, callback: (lock: Lock | null) => unknown): Promise<unknown>;
    query(): Promise<{ held?: { name?: string }[] }>;
}

interface Navigator {
    readonly locks?: LockManager;
}
