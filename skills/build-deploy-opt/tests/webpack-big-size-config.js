// webpack.config.js —— 打包体积臃肿原始配置样例（待优化）
const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',          // 单文件输出，无 contenthash，无分包
  },
  // 缺少 optimization.splitChunks（无代码分割）
  // 缺少 cache 配置（每次全量构建，编译慢）
  // 缺少 tree-shaking 相关 sideEffects 标记
  module: {
    rules: [
      { test: /\.js$/, use: 'babel-loader' },        // 未排除 node_modules，编译慢
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.(png|jpg|gif)$/, use: 'file-loader' }, // 图片未压缩、未转 base64 小图
    ],
  },
  // 缺少 compression-webpack-plugin（无 gzip/brotli）
  // 缺少 BundleAnalyzer 体积分析
  // devtool: 'source-map' 在生产环境会显著增大体积
  devtool: 'source-map',
  resolve: {
    // 缺少 alias，深层相对路径 ../../.. 冗长
    extensions: ['.js', '.vue', '.json'],
  },
};
