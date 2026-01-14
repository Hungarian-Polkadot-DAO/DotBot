const webpack = require('webpack');

module.exports = {
  babel: {
    plugins: ['@babel/plugin-transform-class-static-block'],
  },
  webpack: {
    configure: (webpackConfig) => {
      // Exclude @acala-network/chopsticks-core from bundle (Node.js only, not needed in browser)
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        '@acala-network/chopsticks-core': false,
        'chopsticks-core': false,
      };
      
      // Add fallbacks for Node.js core modules (for other dependencies that might need them)
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        "url": require.resolve("url/"),
        "path": require.resolve("path-browserify"),
        "crypto": require.resolve("crypto-browserify"),
        "stream": require.resolve("stream-browserify"),
        "buffer": require.resolve("buffer/"),
        "util": require.resolve("util/"),
        "fs": false,
        "net": false,
        "tls": false,
        "worker_threads": false,
        "child_process": false,
        "os": false,
        "http": false,
        "https": false,
        "zlib": false,
      };
      
      // Ignore node: protocol imports
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        "node:worker_threads": false,
        "node:child_process": false,
        "node:os": false,
        "node:fs": false,
        "node:path": require.resolve("path-browserify"),
        "node:crypto": require.resolve("crypto-browserify"),
        "node:stream": require.resolve("stream-browserify"),
        "node:url": require.resolve("url/"),
        "node:util": require.resolve("util/"),
        "node:buffer": require.resolve("buffer/"),
      };
      
      // Provide Buffer and process globals
      webpackConfig.plugins = [
        ...webpackConfig.plugins,
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
        // Ignore node: protocol imports
        new webpack.NormalModuleReplacementPlugin(
          /^node:/,
          (resource) => {
            resource.request = resource.request.replace(/^node:/, '');
          }
        ),
      ];
      
      return webpackConfig;
    },
  },
};



