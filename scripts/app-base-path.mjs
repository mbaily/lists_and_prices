/** A build-time public prefix; the reverse proxy removes it before forwarding. */
export function appBasePath(value = process.env.APP_BASE_PATH ?? '') {
    if (value === '' || value === '/') return '';
    if (!/^(?:\/[A-Za-z0-9_~-]+)+$/.test(value)) {
        throw new Error('APP_BASE_PATH must be empty or a path such as /lists (no trailing slash).');
    }
    return value;
}
