/** Frame geometry is independent of camera optics and native object Guide flags. */
export function createFrameComposition() {
    function fit(width: number, height: number, aspect?: number) {
        width = Math.max(1, Number.isFinite(width) ? width : 1);
        height = Math.max(1, Number.isFinite(height) ? height : 1);
        if (aspect === undefined || !Number.isFinite(aspect) || aspect <= 0) {
            return {x: 0, y: 0, width, height};
        }
        const w = Math.min(width, height * aspect), h = w / aspect;
        return {x: (width - w) / 2, y: (height - h) / 2, width: w, height: h};
    }
    function stamp(time: number, rate = 1000) {
        const ms = Math.max(0, Math.round(time * 1000 / rate));
        return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
            .map(v => String(v).padStart(2, '0')).join(':') + '.' + String(ms % 1000).padStart(3, '0');
    }
    return {fit, stamp};
}
