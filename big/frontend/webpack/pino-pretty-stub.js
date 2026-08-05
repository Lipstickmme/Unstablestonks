// Stub for pino-pretty in browser builds
// WalletConnect pulls this in indirectly; we don't need pretty logs in the client.
module.exports = () => null;
module.exports.default = () => null;
