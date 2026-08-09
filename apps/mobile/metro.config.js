// expo/metro-config detects the pnpm workspace root on its own; the only
// customisation here is NativeWind's CSS pipeline.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './src/global.css' });
