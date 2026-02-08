const webpack = require('webpack');

module.exports = {
  babel: {
    plugins: ['@babel/plugin-transform-class-static-block'],
  },
  webpack: {
    configure: (webpackConfig) => {
      // Provide process polyfill for React and dependencies that need process.env
      // Webpack's ProvidePlugin provides process via 'process/browser' package
      webpackConfig.plugins.push(
        new webpack.ProvidePlugin({
          process: 'process/browser',
        })
      );
      
      // Also add process to resolve.fallback to ensure it resolves correctly
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        process: require.resolve('process/browser'),
      };
      
      // Define process.env.NODE_ENV for React (REACT_APP_* vars are handled by CRA automatically)
      webpackConfig.plugins.push(
        new webpack.DefinePlugin({
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        })
      );
      
      // Handle node: protocol imports (strip "node:" prefix)
      // This is required for modules that use "node:worker_threads" etc.
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:/,
          (resource) => {
            resource.request = resource.request.replace(/^node:/, '');
          }
        )
      );
      
      // Add minimal fallbacks for Node.js-only modules
      // These should be false in browser (not available)
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false,
        path: false,
        worker_threads: false,
        child_process: false,
        net: false,
        tls: false,
        os: false,
        http: false,
        https: false,
        zlib: false,
      };
      
      // Ignore missing source maps from node_modules
      // This prevents warnings about missing .ts files from @dotbot/core package
      webpackConfig.module.rules = webpackConfig.module.rules.map(rule => {
        if (rule.oneOf) {
          return {
            ...rule,
            oneOf: rule.oneOf.map(subRule => {
              if (subRule.loader && subRule.loader.includes('source-map-loader')) {
                return {
                  ...subRule,
                  exclude: /node_modules/,
                };
              }
              return subRule;
            }),
          };
        }
        return rule;
      });
      
      return webpackConfig;
    },
  },
};
