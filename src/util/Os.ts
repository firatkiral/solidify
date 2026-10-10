// The operating system, as Node names it: Node's own when there is one (as in the tests), otherwise from the browser
export const os: string = (() => {
    if (typeof process !== 'undefined' && process.platform) return process.platform;
    const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { userAgentData?: { platform: string } } : undefined;
    const platform = nav?.userAgentData?.platform || nav?.platform || '';
    if (/^mac/i.test(platform)) return 'darwin';
    if (/^win/i.test(platform)) return 'win32';
    return 'linux';
})();

export const isMac = os === 'darwin';
export const isLinux = os === 'linux';

// Most likely navigated with a touchpad or fingers: a Mac (iPads report as one too), a phone or a tablet
export const prefersTouchpad = isMac || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
