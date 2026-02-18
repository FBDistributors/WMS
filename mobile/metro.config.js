const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * react-native-screens -> mock (fabric codegen xatosini oldini olish).
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react-native-screens') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'src/mocks/react-native-screens.js'),
        };
      }
      // React Native da Node (crypto, http) yo'q — axios uchun browser build
      if (moduleName === 'axios') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'node_modules/axios/dist/browser/axios.cjs'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
