// Lets the demo import the SDK straight from ../../sdk/expo (no npm publish needed).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const sdk = path.resolve(__dirname, "../../sdk/expo");
config.watchFolders = [sdk];
config.resolver.extraNodeModules = { "@missive/expo-push": sdk };
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
