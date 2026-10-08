// Browser APIs for installed web apps that this TypeScript's DOM types predate; only the parts the app uses

// Chrome and Edge's offer to install the app
interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
}

interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
}

// The files the installed app was opened with from the desktop, by the manifest's file_handlers
interface LaunchParams {
    readonly files: readonly FileSystemHandle[];
}

interface LaunchQueue {
    setConsumer(consumer: (params: LaunchParams) => void): void;
}

interface Window {
    // Chromium only
    readonly launchQueue?: LaunchQueue;
}
