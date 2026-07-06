module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Алиас '@/...' -> './src/...' в рантайме Metro (tsconfig paths одного не хватает).
    plugins: [['module-resolver', { root: ['./'], alias: { '@': './src' } }]],
  };
};
